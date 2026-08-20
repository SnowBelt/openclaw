// Project Command Center gateway methods persist project/milestone plans and proof receipts.
import { randomUUID } from "node:crypto";
import path from "node:path";
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
  validatePccAttachmentsListParams,
  validatePccAttachmentsClarifyParams,
  validatePccAttachmentsReadParams,
  validatePccAttachmentsUpdateParams,
  validatePccAttachmentsUploadBeginParams,
  validatePccAttachmentsUploadChunkParams,
  validatePccAttachmentsUploadCommitParams,
  validatePccAttachmentUsageListParams,
  validatePccAttachmentUsageRecordParams,
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
  validatePccProjectPlanCommitParams,
  validatePccPlansGenerateParams,
  validatePccPlansStartParams,
  validatePccPlansGetParams,
  validatePccPlansCancelParams,
  validatePccExecutionStartParams,
  validatePccExecutionGetParams,
  validatePccExecutionControlParams,
  validatePccExecutionReviewParams,
  validatePccPlanningPolicyGetParams,
  validatePccPlanningPolicyUpsertParams,
  validatePccReceiptsAddParams,
  validatePccSummaryGetParams,
  validatePccOverviewGetParams,
  validatePccPresenceListParams,
  validatePccPresenceUpdateParams,
} from "../../../packages/gateway-protocol/src/index.js";
import { assessControlDirectorResourceAdmission } from "../../agents/control-director-resource-admission.js";
import { executionApprovalFromPccPermission } from "../../agents/execution-approval-envelope.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { recordPccModelRunReceipt, summarizePccProjectAiUsage } from "../../pcc/ai-usage.js";
import { clarifyPccAttachmentInstructions } from "../../pcc/attachment-instructions.js";
import {
  appendPccAttachmentChunk,
  beginPccAttachmentUpload,
  commitPccAttachmentUpload,
  listPccAttachments,
  listPccAttachmentUsage,
  readPccAttachmentChunk,
  recordPccAttachmentUsage,
  updatePccAttachment,
} from "../../pcc/attachments.js";
import { evaluatePccCapabilityEvidence } from "../../pcc/capability-evidence.js";
import {
  isPccCompleteStatus,
  isPccSkippedStatus,
  pccSubMilestonesAreComplete,
} from "../../pcc/domain/completion-policy.js";
import {
  createPccExecutionPlan,
  consumePccExecutionPlanCodexApproval,
  partitionPccExecutionTasks,
  transitionPccExecutionPlan,
  type PccExecutionPlan,
} from "../../pcc/execution-plan.js";
import { normalizePccExecutionProfile } from "../../pcc/execution-profile.js";
import {
  registerPccExecutionRun,
  getRegisteredPccExecutionRun,
  unregisterPccExecutionRun,
} from "../../pcc/execution-reconciliation.js";
import {
  findNextPccExecutionCandidate,
  pccExecutionIdempotencyKeys,
  pccExecutionPlanId,
  pccExecutionPlansFromProject,
  pccExecutionStatusIsActive,
  pccExecutionStatusIsTerminal,
  pccExecutionWorkspaceLease,
  repairPccExecutionMetadata,
  withPccExecutionPlanMetadata,
} from "../../pcc/execution-service.js";
import {
  closePccLedgerStorageForTest,
  pccLedgerJsonPath as ledgerPath,
  pccLedgerSqlitePath,
  pccLedgerRevision,
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
import { buildPccOverview } from "../../pcc/overview.js";
import {
  cancelPccPlanningRun,
  readPccPlanningRun,
  resetPccPlanningRunsForTest,
  startPccPlanningRun,
} from "../../pcc/planning-run-store.js";
import { generatePccPlan } from "../../pcc/planning-runtime.js";
import {
  DEFAULT_PCC_PLANNING_POLICY,
  normalizePccPlanningPolicy,
  parsePccPlanGenerationResult,
  resolvePccPlanningPolicy,
  resolvePccPlanningEffort,
  type PccPlanGenerationRequest,
  type PccPlanningPolicy,
} from "../../pcc/planning.js";
import { listPccPresence, resetPccPresenceForTest, updatePccPresence } from "../../pcc/presence.js";
import {
  normalizePccPrivateTeamPolicy,
  projectCapacityError,
} from "../../pcc/private-team-policy.js";
import { buildPccLedgerReadIndex, pccIndexedItems } from "../../pcc/read-model/ledger-index.js";
import {
  summarizePccPortfolio as summarizePortfolio,
  summarizePccProject as summarizeProject,
} from "../../pcc/read-model/project-summary.js";
import { readReleaseGovernanceStatus } from "../../pcc/release-governance/store.js";
import { readPccRuntimeIdentity, type PccRuntimeIdentity } from "../../pcc/runtime-identity.js";
import { readPccUpdateSafety } from "../../pcc/update-safety.js";
import { listTaskRecords } from "../../tasks/runtime-internal.js";
import { listAgentsForGateway } from "../session-utils.js";
import type {
  GatewayClient,
  GatewayRequestContext,
  GatewayRequestHandlers,
  RespondFn,
} from "./types.js";

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
const PCC_LOCAL_MODEL_PROVIDERS = new Set(["llama-cpp", "lmstudio", "local", "mlx", "ollama"]);
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

let pccPlanGenerator = generatePccPlan;

function isolatedPlanFixtureEnabled(): boolean {
  return (
    process.env.VITEST === "1" &&
    process.env.OPENCLAW_TEST_MINIMAL_GATEWAY === "1" &&
    process.env.OPENCLAW_PCC_LIVE_E2E_PLAN_FIXTURE === "1"
  );
}

function generateIsolatedPlanFixture(request: PccPlanGenerationRequest, policy: PccPlanningPolicy) {
  const title = request.existingTitle?.trim() || "Disposable PCC Workflow Proof";
  const goal = request.existingGoal?.trim() || request.description.trim();
  const milestone = (
    milestoneTitle: string,
    phaseId: string,
    dependency?: number,
    responsibility = "local_openclaw_agent",
  ) => ({
    title: milestoneTitle,
    phaseId,
    implementationPlan: `Complete and verify ${milestoneTitle.toLowerCase()}.`,
    acceptanceCriteria: [`${milestoneTitle} is complete and evidence is recorded.`],
    responsibility,
    proofLevel: "local",
    dependencies: dependency === undefined ? [] : [dependency],
    subMilestones: [
      {
        title: `Verify ${milestoneTitle.toLowerCase()}`,
        implementationPlan: `Run the deterministic check for ${milestoneTitle.toLowerCase()}.`,
        acceptanceCriteria: [`The ${milestoneTitle.toLowerCase()} check passes.`],
        responsibility: "local_openclaw_agent",
        proofLevel: "local",
      },
    ],
  });
  return parsePccPlanGenerationResult({
    text: JSON.stringify({
      title,
      goal,
      outcomeMetrics: ["The disposable project completes its isolated verification."],
      workflowTemplateId: request.preferredTemplateId ?? "software-product",
      milestones: [
        milestone("Define scope", "setup"),
        milestone("Implement workflow", "mvp", 0),
        milestone("Verify behavior", "production-proof", 1, "remote_proof"),
        milestone("Record maintenance handoff", "maintenance", 2),
      ],
      risks: ["This fixture is valid only inside the isolated PCC browser proof Gateway."],
      assumptions: ["No live Codex request is made by the isolated proof."],
    }),
    effort: resolvePccPlanningEffort(request, policy),
    policy,
    model: policy.model,
    auth: "none",
    source: "isolated_test_fixture",
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

async function readPccExecutionCapacity(config: OpenClawConfig) {
  const assessment = await assessControlDirectorResourceAdmission({
    config,
    tasks: listTaskRecords(),
  });
  return {
    ...assessment.hostCapacity,
    controlDirectorAdmission: assessment.admission,
    warnings: [
      ...assessment.hostCapacity.warnings,
      ...assessment.residency.warnings,
      ...(assessment.admission
        ? [`Control Director resource governor: ${assessment.admission.reason}`]
        : []),
    ],
  };
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
  const evidenceMetadata = pccMetadataObject(evidence.metadata);
  const evidenceProofProfile =
    evidenceMetadata.proofProfile === "default" ||
    evidenceMetadata.proofProfile === "mac_studio_control_director"
      ? evidenceMetadata.proofProfile
      : null;
  const isLocalSourceProof =
    evidenceProofProfile === "mac_studio_control_director" &&
    (isRuntimeProof || evidenceMetadata.pccProductionSourceProof === true);
  const nextTruth = {
    ...truth,
    ...(evidenceProofProfile ? { proofProfile: evidenceProofProfile } : {}),
    ...(isLocalSourceProof
      ? {
          latestVerifiedSha: evidence.sha,
          sourceProofSha: evidence.sha,
          sourceProofPassed: true,
        }
      : {}),
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
    revision: nextRecordRevision(project),
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

function recordRevision(record: { revision?: number } | null | undefined): number {
  return record?.revision ?? 1;
}

function revisionConflict(
  record: { id: string; revision?: number } | null | undefined,
  expectedRevision: number | undefined,
): string | null {
  if (!record) {
    return null;
  }
  if (expectedRevision === undefined) {
    return `Review latest changes before saving ${record.id}. Expected revision ${recordRevision(record)} must be provided for an existing record.`;
  }
  if (recordRevision(record) === expectedRevision) {
    return null;
  }
  return `Review latest changes before saving ${record.id}. Expected revision ${expectedRevision}, but the current revision is ${recordRevision(record)}.`;
}

function nextRecordRevision(record: { revision?: number } | null | undefined): number {
  return record ? recordRevision(record) + 1 : 1;
}

function generatedExecutionResponsibility(value: string): string {
  return value === "remote_proof" || value === "user" ? value : "local_openclaw_agent";
}

function pccActor(client: GatewayClient | null): string {
  return client?.connect.client.displayName?.trim() || "PCC operator";
}

function attributedMetadata(
  metadata: unknown,
  actor: string,
  action: string,
): Record<string, unknown> {
  return { ...pccMetadataObject(metadata), pccLastActor: actor, pccLastAction: action };
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

function broadcastPccChanged(
  context: GatewayRequestContext,
  mutation: string,
  projectId?: string,
  recordId?: string,
): void {
  context.broadcast(
    "pcc.changed",
    {
      ledgerRevision: pccLedgerRevision() ?? 0,
      changedAt: nowIso(),
      mutation,
      ...(projectId ? { projectId } : {}),
      ...(recordId ? { recordId } : {}),
    },
    { dropIfSlow: true },
  );
}

type PccExecutionStoredResult = { project: PccProject; plan: PccExecutionPlan };

const PCC_EXECUTION_ORPHAN_GRACE_MS = 2 * 60 * 1_000;
const PCC_EXECUTION_RUN_STATUSES = new Set(["prepared", "dispatching", "running"]);

function persistStoredPccExecutionPlan(
  ledger: PccLedger,
  plan: PccExecutionPlan,
  updatedAt: string,
): PccExecutionStoredResult | { error: string } {
  const project = projectOrError(ledger, plan.projectId);
  if (!project) {
    return { error: `project not found: ${plan.projectId}` };
  }
  const keys = pccExecutionIdempotencyKeys(project);
  const idempotencyKey =
    Object.entries(keys).find(([, value]) => value === plan.id)?.[0] ?? `recovered:${plan.id}`;
  project.metadata = withPccExecutionPlanMetadata(project, plan, idempotencyKey, updatedAt);
  project.revision = (project.revision ?? 1) + 1;
  project.updatedAt = updatedAt;
  return { project, plan };
}

function pccExecutionRunIsTracked(context: GatewayRequestContext, plan: PccExecutionPlan): boolean {
  const runIds = new Set([plan.id, plan.coordinator.runId]);
  if ([...runIds].some((runId) => Boolean(getRegisteredPccExecutionRun(runId)))) {
    return true;
  }
  for (const runId of runIds) {
    const entry = context.chatAbortControllers.get(runId);
    if (!entry) {
      continue;
    }
    if (entry.sessionKey === plan.coordinator.sessionId && entry.projectSessionActive !== false) {
      return true;
    }
  }
  return false;
}

/** Reconciles persisted plans that survived a Gateway lifecycle without their run. */
function reconcileOrphanedPccExecutionPlans(
  context: GatewayRequestContext,
  projectId?: string,
): { projectIds: string[]; planIds: string[] } {
  const ledger = readLedger();
  const nowMs = Date.now();
  const candidates = ledger.projects.some(
    (project) =>
      (!projectId || project.id === projectId) &&
      pccExecutionPlansFromProject(project).some(
        (plan) =>
          PCC_EXECUTION_RUN_STATUSES.has(plan.status) &&
          Number.isFinite(Date.parse(plan.updatedAt)) &&
          nowMs - Date.parse(plan.updatedAt) >= PCC_EXECUTION_ORPHAN_GRACE_MS &&
          !pccExecutionRunIsTracked(context, plan),
      ),
  );
  if (!candidates) {
    return { projectIds: [], planIds: [] };
  }
  return withLedger(
    (currentLedger) => {
      const projectIds: string[] = [];
      const planIds: string[] = [];
      for (const project of currentLedger.projects) {
        if (projectId && project.id !== projectId) {
          continue;
        }
        for (const plan of pccExecutionPlansFromProject(project)) {
          if (
            !PCC_EXECUTION_RUN_STATUSES.has(plan.status) ||
            !Number.isFinite(Date.parse(plan.updatedAt)) ||
            nowMs - Date.parse(plan.updatedAt) < PCC_EXECUTION_ORPHAN_GRACE_MS ||
            pccExecutionRunIsTracked(context, plan)
          ) {
            continue;
          }
          const transitioned = transitionPccExecutionPlan(plan, "lost", {
            at: new Date(nowMs).toISOString(),
            reason:
              "The Gateway no longer reports the supervised run after its persisted execution grace period.",
          });
          const nextPlan = {
            ...transitioned,
            partitions: transitioned.partitions.map((partition) =>
              ["pending", "assigned", "running"].includes(partition.status)
                ? Object.assign({}, partition, { status: "failed" as const })
                : partition,
            ),
          };
          const stored = persistStoredPccExecutionPlan(currentLedger, nextPlan, nextPlan.updatedAt);
          if ("error" in stored) {
            continue;
          }
          projectIds.push(stored.project.id);
          planIds.push(stored.plan.id);
        }
      }
      return { projectIds, planIds };
    },
    { write: true, auditKind: "pcc.execution.lost" },
  );
}

function executionPlanPrompt(params: {
  project: PccProject;
  plan: PccExecutionPlan;
  taskTitle: string;
  model: string;
}): string {
  return [
    "You are the PCC supervised execution coordinator.",
    `Project: ${params.project.title} (${params.project.id})`,
    `Project goal: ${params.project.goal ?? "No goal recorded."}`,
    `Execution plan: ${params.plan.id}`,
    `Local model: ${params.model}`,
    `Workspace: ${params.plan.workspacePath ?? "Use only the Gateway-assigned agent workspace; no project path was configured."}`,
    `Workspace lease: ${params.plan.leases[0]?.workspaceId ?? "none"}`,
    `Task: ${params.taskTitle}`,
    "Execute only this task in the assigned local workspace. Do not deploy, publish, change credentials, trade, purchase, reboot, modify unrelated projects, or perform external writes.",
    "Do not mark a PCC milestone or sub-milestone complete. Return proof candidates, changed files, checks, blockers, and remaining risks for later review.",
    "If the task is unsafe, gated, unavailable, or ambiguous, stop and report that exact blocker instead of substituting work.",
  ].join("\n\n");
}

function configuredPccWorkspacePath(project: PccProject): string | undefined {
  const metadata = pccMetadataObject(project.metadata);
  for (const key of ["pccWorkspacePath", "pccProjectWorkspacePath", "workspacePath"]) {
    const value = metadata[key];
    if (typeof value === "string" && path.isAbsolute(value) && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

async function resolvePccExecutionCoordinator(context: GatewayRequestContext): Promise<{
  agentId: string;
  model: string;
  provider: string;
}> {
  const config = context.getRuntimeConfig();
  const catalog = await context.loadGatewayModelCatalog({ readOnly: true });
  const listed = listAgentsForGateway(config, catalog);
  const candidate =
    listed.agents.find((agent) => agent.role === "program_manager") ??
    listed.agents.find((agent) => agent.id === listed.defaultId) ??
    listed.agents[0];
  const model = candidate?.model?.primary?.trim();
  if (!candidate || !model) {
    throw new Error("No configured local OpenClaw coordinator/model is available.");
  }
  const runtimeId = candidate.agentRuntime?.id?.trim().toLowerCase();
  if (runtimeId === "codex" || /(^|[/:])codex([/:]|$)/u.test(model.toLowerCase())) {
    throw new Error("The configured coordinator resolves to Codex; local execution is required.");
  }
  const matchingCatalogEntry = catalog.find((entry) => {
    const qualified = `${entry.provider}/${entry.id}`;
    return entry.id === model || qualified === model || `${entry.provider}:${entry.id}` === model;
  });
  if (
    !matchingCatalogEntry ||
    (matchingCatalogEntry.route !== "local" &&
      !PCC_LOCAL_MODEL_PROVIDERS.has(matchingCatalogEntry.provider.trim().toLowerCase()))
  ) {
    throw new Error(`Model ${model} is not a verified local model.`);
  }
  const provider = matchingCatalogEntry.provider.trim();
  return { agentId: candidate.id, model, provider };
}

async function dispatchPccExecutionPlan(params: {
  context: GatewayRequestContext;
  client: GatewayClient | null;
  plan: PccExecutionPlan;
  project: PccProject;
  taskTitle: string;
  dispatchKey?: string;
}): Promise<{ runId: string; status: string }> {
  const { chatHandlers } = await import("./chat.js");
  const dispatchKey = params.dispatchKey?.trim() || params.plan.id;
  const acknowledgement = await new Promise<{ runId?: string; status?: string }>(
    (resolve, reject) => {
      let acknowledged = false;
      const request = chatHandlers["chat.send"]({
        req: {
          type: "req",
          id: `pcc-execution:${dispatchKey}`,
          method: "chat.send",
        },
        client: params.client,
        isWebchatConnect: () => false,
        context: params.context,
        params: {
          sessionKey: params.plan.coordinator.sessionId,
          agentId: params.plan.partitions[0]?.workerId,
          message: executionPlanPrompt({
            project: params.project,
            plan: params.plan,
            taskTitle: params.taskTitle,
            model: params.plan.partitions[0]?.modelId ?? "local model selected by Gateway",
          }),
          deliver: false,
          suppressCommandInterpretation: true,
          idempotencyKey: dispatchKey,
        },
        respond: (ok: boolean, result?: unknown, error?: { message?: string }) => {
          acknowledged = true;
          if (!ok) {
            reject(new Error(error?.message ?? "PCC execution chat dispatch failed."));
            return;
          }
          const value = result && typeof result === "object" ? result : {};
          const record = value as Record<string, unknown>;
          resolve({
            ...(typeof record.runId === "string" ? { runId: record.runId } : {}),
            status: typeof record.status === "string" ? record.status : "started",
          });
        },
      } as Parameters<(typeof chatHandlers)["chat.send"]>[0]);
      void Promise.resolve(request).then(() => {
        if (!acknowledged) {
          reject(new Error("PCC execution chat dispatch returned without an acknowledgement."));
        }
      }, reject);
    },
  );
  const runId = acknowledgement.runId?.trim() || params.plan.id;
  const status = acknowledgement.status ?? "started";
  if (status === "error" || status === "timeout") {
    throw new Error(`PCC coordinator returned ${status}.`);
  }
  return { runId, status };
}

async function abortPccExecutionRun(params: {
  context: GatewayRequestContext;
  client: GatewayClient | null;
  plan: PccExecutionPlan;
}): Promise<boolean> {
  const runId = params.plan.coordinator.runId.trim();
  if (!runId) {
    return false;
  }
  const { chatHandlers } = await import("./chat.js");
  return await new Promise<boolean>((resolve, reject) => {
    let acknowledged = false;
    const request = chatHandlers["chat.abort"]({
      req: {
        type: "req",
        id: `pcc-execution-abort:${params.plan.id}`,
        method: "chat.abort",
      },
      client: params.client,
      isWebchatConnect: () => false,
      context: params.context,
      params: {
        sessionKey: params.plan.coordinator.sessionId,
        runId,
      },
      respond: (ok: boolean, result?: unknown, error?: { message?: string }) => {
        acknowledged = true;
        if (!ok) {
          reject(new Error(error?.message ?? "PCC execution run could not be stopped."));
          return;
        }
        const value = result && typeof result === "object" ? result : {};
        resolve((value as Record<string, unknown>).aborted === true);
      },
    } as Parameters<(typeof chatHandlers)["chat.abort"]>[0]);
    void Promise.resolve(request).then(() => {
      if (!acknowledged) {
        reject(new Error("PCC execution stop returned without an acknowledgement."));
      }
    }, reject);
  });
}

function readPccExecutionControlTarget(params: {
  projectId: string;
  planId: string;
  expectedRevision?: number;
}): { project: PccProject; plan: PccExecutionPlan } | { error: string } {
  const project = projectOrError(readLedger(), params.projectId);
  if (!project) {
    return { error: `project not found: ${params.projectId}` };
  }
  if (
    params.expectedRevision !== undefined &&
    recordRevision(project) !== params.expectedRevision
  ) {
    return {
      error: `Review latest changes before controlling ${project.id}. Expected revision ${params.expectedRevision}, but the current revision is ${recordRevision(project)}.`,
    };
  }
  const plan = executionPlanForProject(project, params.planId);
  if (!plan) {
    return { error: `execution plan not found: ${params.planId}` };
  }
  return { project, plan };
}

function markPccExecutionBlockedAfterControlFailure(
  projectId: string,
  planId: string,
  reason: string,
): PccExecutionStoredResult | { error: string } {
  return withLedger(
    (ledger) => {
      const project = projectOrError(ledger, projectId);
      const plan = project ? executionPlanForProject(project, planId) : undefined;
      if (!project || !plan) {
        return { error: `execution plan not found: ${planId}` };
      }
      if (pccExecutionStatusIsTerminal(plan.status) || plan.status === "blocked") {
        return { project, plan };
      }
      const nextPlan = transitionPccExecutionPlan(plan, "blocked", {
        at: nowIso(),
        reason,
      });
      return persistStoredPccExecutionPlan(ledger, nextPlan, nextPlan.updatedAt);
    },
    { write: true, auditKind: "pcc.execution.controlFailed" },
  );
}

type PreparedPccExecutionStart = {
  project: PccProject;
  plan: PccExecutionPlan;
  taskTitle: string;
  idempotencyKey: string;
  coordinator: {
    agentId: string;
    model: string;
    provider: string;
  };
};

function projectExecutionPermissions(
  ledger: PccLedger,
  projectId: string,
  profile: ReturnType<typeof normalizePccExecutionProfile>,
  actorId: string,
) {
  if (profile.codexRole === "off") {
    return [];
  }
  const now = Date.now();
  return ledger.permissions
    .filter((permission) => {
      const typeMatches =
        profile.codexEffort === "medium"
          ? permission.type === "codex_usage" || permission.type === "high_reasoning_model"
          : permission.type === "high_reasoning_model";
      const expiresAt = permission.expiresAt
        ? Date.parse(permission.expiresAt)
        : Number.POSITIVE_INFINITY;
      return (
        permission.projectId === projectId &&
        !permission.milestoneId &&
        typeMatches &&
        permission.status === "granted" &&
        expiresAt > now &&
        (permission.maxUses === undefined || permission.usedCount < permission.maxUses)
      );
    })
    .map((permission) =>
      executionApprovalFromPccPermission({
        permission,
        subjectActorId: actorId,
      }),
    );
}

function preparePccExecutionStart(params: {
  ledger: PccLedger;
  projectId: string;
  expectedRevision: number;
  idempotencyKey: string;
  coordinator: {
    agentId: string;
    model: string;
    provider: string;
  };
  now: string;
}): PreparedPccExecutionStart | { existingPlan: PccExecutionPlan } | { error: string } {
  const project = projectOrError(params.ledger, params.projectId);
  if (!project) {
    return { error: `project not found: ${params.projectId}` };
  }
  const currentRevision = recordRevision(project);
  if (currentRevision !== params.expectedRevision) {
    return {
      error: `Review latest changes before starting work on ${project.id}. Expected revision ${params.expectedRevision}, but the current revision is ${currentRevision}.`,
    };
  }
  const plans = pccExecutionPlansFromProject(project);
  const existingId = pccExecutionIdempotencyKeys(project)[params.idempotencyKey];
  if (existingId) {
    const existingPlan = plans.find((plan) => plan.id === existingId);
    if (existingPlan) {
      return { existingPlan };
    }
  }
  const duplicate = plans.find((plan) => pccExecutionStatusIsActive(plan.status));
  if (duplicate) {
    return { error: `PCC execution plan ${duplicate.id} is already active for this project.` };
  }
  if (project.status === "archived" || project.status === "on_hold") {
    return { error: `Project ${project.title} is ${project.status}; resume or reopen it first.` };
  }
  if (isPccCompleteStatus(project.status) || isPccSkippedStatus(project.status)) {
    return { error: `Project ${project.title} is complete or skipped; reopen it before working.` };
  }
  const candidate = findNextPccExecutionCandidate({
    project,
    milestones: params.ledger.milestones,
    subMilestones: params.ledger.subMilestones,
  });
  if (!candidate) {
    return {
      error:
        "No safe local task is ready. Review permissions, dependencies, responsibility, parallelSafe, and workspaceLock metadata.",
    };
  }
  if ("milestoneId" in candidate.item) {
    setAt(params.ledger.subMilestones, candidate.item);
  } else {
    setAt(params.ledger.milestones, candidate.item);
  }
  const profile = normalizePccExecutionProfile(project.metadata);
  const approvals = projectExecutionPermissions(
    params.ledger,
    project.id,
    profile,
    params.coordinator.agentId,
  );
  const planId = pccExecutionPlanId(project.id, params.idempotencyKey);
  const partitioned = partitionPccExecutionTasks([candidate.task], [params.coordinator.agentId]);
  if (partitioned.partitions.length !== 1) {
    return { error: "No independent local execution partition was admitted." };
  }
  const partition = {
    ...partitioned.partitions[0]!,
    modelId: params.coordinator.model,
    modelRationale: "Selected by the Gateway from the verified local model catalog.",
  };
  const lease = pccExecutionWorkspaceLease(planId, partition, params.now);
  if (!lease) {
    return { error: "The admitted task did not have a canonical workspace lease." };
  }
  const workspacePath = configuredPccWorkspacePath(project);
  let plan: PccExecutionPlan;
  try {
    plan = createPccExecutionPlan({
      id: planId,
      projectId: project.id,
      projectRevision: String(currentRevision),
      profile,
      coordinator: {
        // A project may be retried after a terminal run. Never reuse the
        // transcript/session of an older attempt.
        sessionId: `agent:${params.coordinator.agentId}:pcc-execution-${planId}`,
        runId: planId,
      },
      ...(workspacePath ? { workspacePath } : {}),
      admittedWorkerCount: 1,
      partitions: [partition],
      leases: [lease],
      proofRequirements: [
        {
          milestoneId: candidate.milestoneId,
          proofId: `${planId}:proof:${candidate.task.id}`,
          description: `Review implementation output and applicable checks for ${candidate.task.title}.`,
        },
      ],
      approvals,
      createdAt: params.now,
      statusReason: "Execution plan saved before dispatch.",
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  if (plan.mode === "hybrid") {
    const authorization = consumePccExecutionPlanCodexApproval({
      plan,
      actorId: params.coordinator.agentId,
      now: Date.parse(params.now),
    });
    if (!authorization.decision.allowed) {
      return { error: authorization.decision.reason ?? "Codex approval was not granted." };
    }
    plan = authorization.plan;
  }
  project.metadata = {
    ...pccMetadataObject(project.metadata),
    pccExecutionProfile: profile,
    ...withPccExecutionPlanMetadata(project, plan, params.idempotencyKey, params.now),
  };
  project.revision = currentRevision + 1;
  project.updatedAt = params.now;
  return {
    project,
    plan,
    taskTitle: candidate.task.title,
    idempotencyKey: params.idempotencyKey,
    coordinator: params.coordinator,
  };
}

function executionPlanForProject(
  project: PccProject,
  planId?: string,
): PccExecutionPlan | undefined {
  const plans = pccExecutionPlansFromProject(project);
  if (planId) {
    return plans.find((plan) => plan.id === planId);
  }
  const activeId = pccMetadataObject(project.metadata).pccActiveExecutionPlanId;
  if (typeof activeId === "string") {
    const active = plans.find((plan) => plan.id === activeId);
    if (active) {
      return active;
    }
  }
  return plans.at(-1);
}

function existingPccExecutionPlanForIdempotency(params: {
  projectId: string;
  expectedRevision: number;
  idempotencyKey: string;
}): { plan?: PccExecutionPlan; error?: string } {
  const project = projectOrError(readLedger(), params.projectId);
  if (!project) {
    return { error: `project not found: ${params.projectId}` };
  }
  const currentRevision = recordRevision(project);
  if (currentRevision !== params.expectedRevision) {
    return {
      error: `Review latest changes before starting work on ${project.id}. Expected revision ${params.expectedRevision}, but the current revision is ${currentRevision}.`,
    };
  }
  const planId = pccExecutionIdempotencyKeys(project)[params.idempotencyKey];
  return {
    plan: planId
      ? pccExecutionPlansFromProject(project).find((candidate) => candidate.id === planId)
      : undefined,
  };
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
    expectedRevision?: number;
  },
): { project?: PccProject; error?: string } {
  const existing = input.id ? projectOrError(ledger, input.id) : null;
  const conflict = revisionConflict(existing, input.expectedRevision);
  if (conflict) {
    return { error: conflict };
  }
  const timestamp = nowIso();
  const status = input.status ?? existing?.status ?? "active";
  const transitionError = validateStatusTransition("project", existing?.status, status);
  if (transitionError) {
    return { error: transitionError };
  }
  const projectId = existing?.id ?? input.id ?? makeId("project", input.title);
  if (status !== "archived") {
    const capacityError = projectCapacityError(ledger, existing ?? undefined);
    if (capacityError) {
      return { error: capacityError };
    }
  }
  const completionError = ensureProjectCanBeComplete(ledger, projectId, existing?.status, status);
  if (completionError) {
    return { error: completionError };
  }
  const project: PccProject = canonicalizePccProjectForWrite(
    {
      id: projectId,
      revision: nextRecordRevision(existing),
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
    replaceExisting?: boolean;
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
    expectedRevision?: number;
  },
): { milestone?: PccMilestone; error?: string } {
  if (!projectOrError(ledger, input.projectId)) {
    return { error: `project not found: ${input.projectId}` };
  }
  const existing = input.id ? milestoneOrError(ledger, input.id) : null;
  const conflict = revisionConflict(existing, input.expectedRevision);
  if (conflict) {
    return { error: conflict };
  }
  if (existing && existing.projectId !== input.projectId) {
    return {
      error: `milestone ${existing.id} belongs to project ${existing.projectId}; cannot move to project ${input.projectId}`,
    };
  }
  const timestamp = nowIso();
  const id = existing?.id ?? input.id ?? makeId("milestone", input.title);
  const replaceExisting = input.replaceExisting === true;
  const status =
    input.status ?? (replaceExisting ? "not_started" : (existing?.status ?? "not_started"));
  const transitionError = validateStatusTransition("milestone", existing?.status, status);
  if (transitionError) {
    return { error: transitionError };
  }
  const titleError = validateMilestoneTitle(ledger, input.projectId, id, input.title, status);
  if (titleError) {
    return { error: titleError };
  }
  const order = replaceExisting ? input.order : (input.order ?? existing?.order);
  const orderError = validateMilestoneOrder(ledger, input.projectId, id, order, status);
  if (orderError) {
    return { error: orderError };
  }
  const receiptIds = replaceExisting
    ? input.receiptIds
    : (input.receiptIds ?? existing?.receiptIds);
  const referenceError = validateMilestoneReferences(ledger, input.projectId, id, {
    dependsOn: replaceExisting ? input.dependsOn : (input.dependsOn ?? existing?.dependsOn),
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
      revision: nextRecordRevision(existing),
      projectId: input.projectId,
      title: input.title,
      status,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      ...(input.phaseId !== undefined
        ? { phaseId: input.phaseId }
        : !replaceExisting && existing?.phaseId !== undefined
          ? { phaseId: existing.phaseId }
          : {}),
      ...(input.owner !== undefined
        ? { owner: input.owner }
        : !replaceExisting && existing?.owner !== undefined
          ? { owner: existing.owner }
          : {}),
      ...(order !== undefined ? { order } : {}),
      ...(input.percentComplete !== undefined
        ? { percentComplete: input.percentComplete }
        : !replaceExisting && existing?.percentComplete !== undefined
          ? { percentComplete: existing.percentComplete }
          : {}),
      ...(input.dependsOn !== undefined
        ? { dependsOn: input.dependsOn }
        : !replaceExisting && existing?.dependsOn !== undefined
          ? { dependsOn: existing.dependsOn }
          : {}),
      ...(input.requiredEvidenceIds !== undefined
        ? { requiredEvidenceIds: input.requiredEvidenceIds }
        : !replaceExisting && existing?.requiredEvidenceIds !== undefined
          ? { requiredEvidenceIds: existing.requiredEvidenceIds }
          : {}),
      ...(receiptIds !== undefined ? { receiptIds } : {}),
      ...(input.permissionGrantIds !== undefined
        ? { permissionGrantIds: input.permissionGrantIds }
        : !replaceExisting && existing?.permissionGrantIds !== undefined
          ? { permissionGrantIds: existing.permissionGrantIds }
          : {}),
      ...(input.blocker !== undefined
        ? { blocker: input.blocker }
        : !replaceExisting && existing?.blocker !== undefined
          ? { blocker: existing.blocker }
          : {}),
      ...(input.implementationPlan !== undefined
        ? { implementationPlan: input.implementationPlan }
        : !replaceExisting && existing?.implementationPlan !== undefined
          ? { implementationPlan: existing.implementationPlan }
          : {}),
      ...(input.acceptanceCriteria !== undefined
        ? { acceptanceCriteria: input.acceptanceCriteria }
        : !replaceExisting && existing?.acceptanceCriteria !== undefined
          ? { acceptanceCriteria: existing.acceptanceCriteria }
          : {}),
      ...(input.metadata !== undefined
        ? { metadata: input.metadata }
        : !replaceExisting && existing?.metadata !== undefined
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
    replaceExisting?: boolean;
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
    expectedRevision?: number;
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
  const conflict = revisionConflict(existing, input.expectedRevision);
  if (conflict) {
    return { error: conflict };
  }
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
  const replaceExisting = input.replaceExisting === true;
  const status =
    input.status ?? (replaceExisting ? "not_started" : (existing?.status ?? "not_started"));
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
  const order = replaceExisting ? input.order : (input.order ?? existing?.order);
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
  const requiredEvidenceIds = replaceExisting
    ? input.requiredEvidenceIds
    : (input.requiredEvidenceIds ?? existing?.requiredEvidenceIds);
  const receiptIds = replaceExisting
    ? input.receiptIds
    : (input.receiptIds ?? existing?.receiptIds);
  const referenceError = validateSubMilestoneReferences(
    ledger,
    input.projectId,
    input.milestoneId,
    id,
    {
      dependsOn: replaceExisting ? input.dependsOn : (input.dependsOn ?? existing?.dependsOn),
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
      revision: nextRecordRevision(existing),
      projectId: input.projectId,
      milestoneId: input.milestoneId,
      title: input.title,
      status,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      ...(order !== undefined ? { order } : {}),
      ...(input.owner !== undefined
        ? { owner: input.owner }
        : !replaceExisting && existing?.owner !== undefined
          ? { owner: existing.owner }
          : {}),
      ...(input.percentComplete !== undefined
        ? { percentComplete: input.percentComplete }
        : !replaceExisting && existing?.percentComplete !== undefined
          ? { percentComplete: existing.percentComplete }
          : {}),
      ...(input.dependsOn !== undefined
        ? { dependsOn: input.dependsOn }
        : !replaceExisting && existing?.dependsOn !== undefined
          ? { dependsOn: existing.dependsOn }
          : {}),
      ...(requiredEvidenceIds !== undefined ? { requiredEvidenceIds } : {}),
      ...(receiptIds !== undefined ? { receiptIds } : {}),
      ...(input.permissionGrantIds !== undefined
        ? { permissionGrantIds: input.permissionGrantIds }
        : !replaceExisting && existing?.permissionGrantIds !== undefined
          ? { permissionGrantIds: existing.permissionGrantIds }
          : {}),
      ...(input.blocker !== undefined
        ? { blocker: input.blocker }
        : !replaceExisting && existing?.blocker !== undefined
          ? { blocker: existing.blocker }
          : {}),
      ...(input.implementationPlan !== undefined
        ? { implementationPlan: input.implementationPlan }
        : !replaceExisting && existing?.implementationPlan !== undefined
          ? { implementationPlan: existing.implementationPlan }
          : {}),
      ...(input.acceptanceCriteria !== undefined
        ? { acceptanceCriteria: input.acceptanceCriteria }
        : !replaceExisting && existing?.acceptanceCriteria !== undefined
          ? { acceptanceCriteria: existing.acceptanceCriteria }
          : {}),
      ...(input.metadata !== undefined
        ? { metadata: input.metadata }
        : !replaceExisting && existing?.metadata !== undefined
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
  executionRepairs: Array<{ recordId: string; issueCodes: string[] }>;
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
  const executionRepairs: Array<{ recordId: string; issueCodes: string[] }> = [];
  ledger.projects = ledger.projects.map((project) => {
    if (!eligibleProjectIds.has(project.id)) {
      return project;
    }
    const repaired = canonicalizePccProjectForWrite(project, now);
    if (JSON.stringify(repaired) !== JSON.stringify(project)) {
      repairedProjectIds.push(project.id);
      return {
        ...repaired,
        revision: recordRevision(project) + 1,
        updatedAt: now,
      };
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
  ledger.milestones = ledger.milestones.map((milestone) => {
    const repaired = repairedMilestones.get(milestone.id);
    const next =
      !repaired || JSON.stringify(repaired) === JSON.stringify(milestone)
        ? milestone
        : {
            ...repaired,
            revision: recordRevision(milestone) + 1,
            updatedAt: now,
          };
    if (!eligibleProjectIds.has(next.projectId)) {
      return next;
    }
    const executionRepair = repairPccExecutionMetadata(next.projectId, next);
    if (executionRepair.issueCodes.length === 0 || "milestoneId" in executionRepair.item) {
      return next;
    }
    executionRepairs.push({ recordId: next.id, issueCodes: executionRepair.issueCodes });
    return {
      ...executionRepair.item,
      revision: recordRevision(next) + 1,
      updatedAt: now,
    };
  });
  ledger.subMilestones = ledger.subMilestones.map((subMilestone) => {
    const repaired = repairedSubMilestones.get(subMilestone.id);
    const next =
      !repaired || JSON.stringify(repaired) === JSON.stringify(subMilestone)
        ? subMilestone
        : {
            ...repaired,
            revision: recordRevision(subMilestone) + 1,
            updatedAt: now,
          };
    if (!eligibleProjectIds.has(next.projectId)) {
      return next;
    }
    const executionRepair = repairPccExecutionMetadata(next.projectId, next);
    if (executionRepair.issueCodes.length === 0 || !("milestoneId" in executionRepair.item)) {
      return next;
    }
    executionRepairs.push({ recordId: next.id, issueCodes: executionRepair.issueCodes });
    return {
      ...executionRepair.item,
      revision: recordRevision(next) + 1,
      updatedAt: now,
    };
  });
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
    executionRepairs,
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
    aiUsage: summarizePccProjectAiUsage(ledger, project.id),
    summary: summarizeProject(ledger, project, index),
  };
}

export const pccHandlers: GatewayRequestHandlers = {
  "pcc.overview.get": ({ params, respond, context }) => {
    if (!validatePccOverviewGetParams(params)) {
      respondInvalid(respond, "pcc.overview.get", validatePccOverviewGetParams.errors);
      return;
    }
    try {
      const reconciled = reconcileOrphanedPccExecutionPlans(context);
      if (reconciled.planIds.length > 0) {
        broadcastPccChanged(context, "pcc.execution.lost");
      }
      const ledger = readLedger();
      respond(true, buildPccOverview(ledger, pccLedgerRevision() ?? 0));
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.presence.list": ({ params, respond }) => {
    if (!validatePccPresenceListParams(params)) {
      respondInvalid(respond, "pcc.presence.list", validatePccPresenceListParams.errors);
      return;
    }
    respond(true, { presence: listPccPresence() });
  },
  "pcc.presence.update": ({ params, respond, client, context }) => {
    if (!validatePccPresenceUpdateParams(params)) {
      respondInvalid(respond, "pcc.presence.update", validatePccPresenceUpdateParams.errors);
      return;
    }
    try {
      const identity = client?.connect.device?.id ?? client?.connId;
      if (!identity) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "PCC presence requires an authenticated client identity.",
          ),
        );
        return;
      }
      const presence = updatePccPresence(identity, {
        ...params,
        displayName: client?.connect.client.displayName?.trim() || params.displayName,
      });
      respond(true, { presence });
      context.broadcast("pcc.presence", { presence }, { dropIfSlow: true });
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.projects.list": ({ params, respond, context }) => {
    if (!validatePccProjectsListParams(params)) {
      respondInvalid(respond, "pcc.projects.list", validatePccProjectsListParams.errors);
      return;
    }
    try {
      const reconciled = reconcileOrphanedPccExecutionPlans(context);
      if (reconciled.planIds.length > 0) {
        broadcastPccChanged(context, "pcc.execution.lost");
      }
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
  "pcc.projects.get": ({ params, respond, context }) => {
    if (!validatePccProjectsGetParams(params)) {
      respondInvalid(respond, "pcc.projects.get", validatePccProjectsGetParams.errors);
      return;
    }
    try {
      const reconciled = reconcileOrphanedPccExecutionPlans(context, params.projectId);
      if (reconciled.planIds.length > 0) {
        broadcastPccChanged(context, "pcc.execution.lost", params.projectId);
      }
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
  "pcc.plans.generate": async ({ params, respond, context }) => {
    if (!validatePccPlansGenerateParams(params)) {
      respondInvalid(respond, "pcc.plans.generate", validatePccPlansGenerateParams.errors);
      return;
    }
    try {
      const request = params as PccPlanGenerationRequest;
      const policy = resolvePccPlanningPolicy(
        readLedger().settings?.planningPolicy,
        request.plannerMode,
      );
      const plan = isolatedPlanFixtureEnabled()
        ? generateIsolatedPlanFixture(request, policy)
        : await pccPlanGenerator({
            cfg: context.getRuntimeConfig(),
            request,
            policy,
          });
      respond(true, { plan });
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.plans.start": async ({ params, respond, context }) => {
    if (!validatePccPlansStartParams(params)) {
      respondInvalid(respond, "pcc.plans.start", validatePccPlansStartParams.errors);
      return;
    }
    try {
      const request = params as PccPlanGenerationRequest;
      const ledger = readLedger();
      const policy = resolvePccPlanningPolicy(ledger.settings?.planningPolicy, request.plannerMode);
      const privateTeamPolicy = normalizePccPrivateTeamPolicy(ledger.settings?.privateTeamPolicy);
      const run = await startPccPlanningRun({
        cfg: context.getRuntimeConfig(),
        request,
        policy,
        maxConcurrentRuns: privateTeamPolicy.maxConcurrentPlanningRuns,
        ...(isolatedPlanFixtureEnabled()
          ? {
              generatePlan: async () => generateIsolatedPlanFixture(request, policy),
            }
          : { generatePlan: pccPlanGenerator }),
      });
      respond(true, { run });
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.plans.get": async ({ params, respond }) => {
    if (!validatePccPlansGetParams(params)) {
      respondInvalid(respond, "pcc.plans.get", validatePccPlansGetParams.errors);
      return;
    }
    try {
      const run = await readPccPlanningRun(params.runId);
      if (!run) {
        respondNotFound(respond, `planning run ${params.runId}`);
        return;
      }
      respond(true, { run });
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.plans.cancel": async ({ params, respond }) => {
    if (!validatePccPlansCancelParams(params)) {
      respondInvalid(respond, "pcc.plans.cancel", validatePccPlansCancelParams.errors);
      return;
    }
    try {
      respond(true, { run: await cancelPccPlanningRun(params.runId) });
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.execution.start": async ({ params, respond, context, client }) => {
    if (!validatePccExecutionStartParams(params)) {
      respondInvalid(respond, "pcc.execution.start", validatePccExecutionStartParams.errors);
      return;
    }
    try {
      // Idempotent retries must return the persisted plan before resolving the
      // model catalog. A transient catalog outage must not turn a previously
      // accepted execution into a second or apparently missing run.
      const existing = existingPccExecutionPlanForIdempotency(params);
      if (existing.error) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, existing.error));
        return;
      }
      if (existing.plan) {
        respond(true, { plan: existing.plan });
        return;
      }
      const coordinator = await resolvePccExecutionCoordinator(context);
      const prepared = withLedger(
        (ledger) =>
          preparePccExecutionStart({
            ledger,
            projectId: params.projectId,
            expectedRevision: params.expectedRevision,
            idempotencyKey: params.idempotencyKey,
            coordinator,
            now: nowIso(),
          }),
        { write: true, auditKind: "pcc.execution.start" },
      );
      if ("error" in prepared) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, prepared.error));
        return;
      }
      if ("existingPlan" in prepared) {
        respond(true, { plan: prepared.existingPlan });
        return;
      }

      const dispatching = withLedger(
        (ledger) => {
          const project = projectOrError(ledger, params.projectId);
          const plan = project ? executionPlanForProject(project, prepared.plan.id) : undefined;
          if (!project || !plan) {
            return { error: "The prepared PCC execution plan was not found." };
          }
          const nextPlan = transitionPccExecutionPlan(plan, "dispatching", {
            at: nowIso(),
            reason: "Verified local coordinator dispatch is starting.",
          });
          return persistStoredPccExecutionPlan(ledger, nextPlan, nextPlan.updatedAt);
        },
        { write: true, auditKind: "pcc.execution.dispatching" },
      );
      if ("error" in dispatching) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, dispatching.error));
        return;
      }

      const partition = dispatching.plan.partitions[0];
      const taskId = partition?.taskId ?? "";
      const registerRun = (runId: string) => {
        registerPccExecutionRun({
          projectId: dispatching.project.id,
          planId: dispatching.plan.id,
          runId,
          ...(taskId.startsWith("milestone:")
            ? { milestoneId: taskId.slice("milestone:".length) }
            : taskId.startsWith("submilestone:")
              ? { subMilestoneId: taskId.slice("submilestone:".length) }
              : {}),
          model: partition?.modelId ?? coordinator.model,
          provider: coordinator.provider,
          startedAt: dispatching.plan.createdAt,
          broadcast: (projectId, planId) =>
            broadcastPccChanged(context, "pcc.execution.reconcile", projectId, planId),
        });
      };
      registerRun(dispatching.plan.id);
      let acknowledgement: { runId: string; status: string };
      try {
        acknowledgement = await dispatchPccExecutionPlan({
          context,
          client,
          plan: dispatching.plan,
          project: dispatching.project,
          taskTitle: prepared.taskTitle,
        });
      } catch (error) {
        unregisterPccExecutionRun(dispatching.plan.id);
        const failed = withLedger(
          (ledger) => {
            const project = projectOrError(ledger, params.projectId);
            const plan = project
              ? executionPlanForProject(project, dispatching.plan.id)
              : undefined;
            if (!project || !plan) {
              return { error: "The dispatching PCC execution plan was not found." };
            }
            const nextPlan = transitionPccExecutionPlan(plan, "failed", {
              at: nowIso(),
              reason: error instanceof Error ? error.message : String(error),
            });
            return persistStoredPccExecutionPlan(ledger, nextPlan, nextPlan.updatedAt);
          },
          { write: true, auditKind: "pcc.execution.dispatchFailed" },
        );
        if ("error" in failed) {
          respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, failed.error));
        } else {
          broadcastPccChanged(context, "pcc.execution.failed", failed.project.id, failed.plan.id);
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.UNAVAILABLE,
              error instanceof Error ? error.message : String(error),
              { retryable: true },
            ),
          );
        }
        return;
      }

      if (acknowledgement.runId !== dispatching.plan.id) {
        unregisterPccExecutionRun(dispatching.plan.id);
      }
      registerRun(acknowledgement.runId);
      const running = withLedger(
        (ledger) => {
          const project = projectOrError(ledger, params.projectId);
          const plan = project ? executionPlanForProject(project, dispatching.plan.id) : undefined;
          if (!project || !plan) {
            return { error: "The running PCC execution plan was not found." };
          }
          if (pccExecutionStatusIsTerminal(plan.status)) {
            return { project, plan };
          }
          const nextPlan = {
            ...transitionPccExecutionPlan(plan, "running", {
              at: nowIso(),
              reason: "Verified local coordinator accepted the execution plan.",
            }),
            coordinator: { ...plan.coordinator, runId: acknowledgement.runId },
          };
          return persistStoredPccExecutionPlan(ledger, nextPlan, nextPlan.updatedAt);
        },
        { write: true, auditKind: "pcc.execution.running" },
      );
      if ("error" in running) {
        unregisterPccExecutionRun(acknowledgement.runId);
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, running.error));
        return;
      }
      if (pccExecutionStatusIsTerminal(running.plan.status)) {
        unregisterPccExecutionRun(acknowledgement.runId);
      }
      respond(true, { plan: running.plan });
      broadcastPccChanged(context, "pcc.execution.start", running.project.id, running.plan.id);
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.execution.get": ({ params, respond, context }) => {
    if (!validatePccExecutionGetParams(params)) {
      respondInvalid(respond, "pcc.execution.get", validatePccExecutionGetParams.errors);
      return;
    }
    try {
      const reconciled = reconcileOrphanedPccExecutionPlans(context, params.projectId);
      if (reconciled.planIds.length > 0) {
        broadcastPccChanged(context, "pcc.execution.lost", params.projectId);
      }
      const project = projectOrError(readLedger(), params.projectId);
      if (!project) {
        respondNotFound(respond, `project ${params.projectId}`);
        return;
      }
      respond(true, { plan: executionPlanForProject(project, params.planId) ?? null });
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.execution.pause": async ({ params, respond, context, client }) => {
    if (!validatePccExecutionControlParams(params)) {
      respondInvalid(respond, "pcc.execution.pause", validatePccExecutionControlParams.errors);
      return;
    }
    try {
      const target = readPccExecutionControlTarget(params);
      if ("error" in target) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, target.error));
        return;
      }
      if (target.plan.status === "paused") {
        respond(true, { plan: target.plan });
        return;
      }
      if (!pccExecutionStatusIsActive(target.plan.status)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `execution plan ${target.plan.id} cannot be paused from ${target.plan.status}`,
          ),
        );
        return;
      }
      try {
        const aborted = await abortPccExecutionRun({ context, client, plan: target.plan });
        if (!aborted && ["dispatching", "running"].includes(target.plan.status)) {
          throw new Error("The Gateway did not confirm that the active coordinator run stopped.");
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const blocked = markPccExecutionBlockedAfterControlFailure(
          target.project.id,
          target.plan.id,
          `Pause could not be confirmed: ${reason}`,
        );
        if ("error" in blocked) {
          respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, blocked.error));
        } else {
          broadcastPccChanged(
            context,
            "pcc.execution.controlFailed",
            blocked.project.id,
            blocked.plan.id,
          );
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.UNAVAILABLE,
              `PCC execution pause could not be confirmed: ${reason}`,
              { retryable: true },
            ),
          );
        }
        return;
      }
      const result = withLedger(
        (ledger) => {
          const project = projectOrError(ledger, params.projectId);
          if (!project) {
            return { error: `project not found: ${params.projectId}` };
          }
          if (
            params.expectedRevision !== undefined &&
            recordRevision(project) !== params.expectedRevision
          ) {
            return {
              error: `Review latest changes before pausing ${project.id}. Expected revision ${params.expectedRevision}, but the current revision is ${recordRevision(project)}.`,
            };
          }
          const plan = executionPlanForProject(project, params.planId);
          if (!plan) {
            return { error: `execution plan not found: ${params.planId}` };
          }
          if (plan.status === "paused") {
            return { project, plan };
          }
          if (!["dispatching", "running", "blocked"].includes(plan.status)) {
            return { error: `execution plan ${plan.id} cannot be paused from ${plan.status}` };
          }
          const nextPlan = transitionPccExecutionPlan(plan, "paused", {
            at: nowIso(),
            reason: "Paused by the PCC operator.",
          });
          return persistStoredPccExecutionPlan(ledger, nextPlan, nextPlan.updatedAt);
        },
        { write: true, auditKind: "pcc.execution.pause" },
      );
      if ("error" in result) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, result.error));
        return;
      }
      respond(true, { plan: result.plan });
      broadcastPccChanged(context, "pcc.execution.pause", result.project.id, result.plan.id);
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.execution.resume": async ({ params, respond, context, client }) => {
    if (!validatePccExecutionControlParams(params)) {
      respondInvalid(respond, "pcc.execution.resume", validatePccExecutionControlParams.errors);
      return;
    }
    try {
      const target = readPccExecutionControlTarget(params);
      if ("error" in target) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, target.error));
        return;
      }
      if (target.plan.status !== "paused") {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `execution plan ${target.plan.id} can only be resumed from paused, not ${target.plan.status}`,
          ),
        );
        return;
      }
      const dispatching = withLedger(
        (ledger) => {
          const project = projectOrError(ledger, params.projectId);
          if (!project) {
            return { error: `project not found: ${params.projectId}` };
          }
          if (
            params.expectedRevision !== undefined &&
            recordRevision(project) !== params.expectedRevision
          ) {
            return {
              error: `Review latest changes before resuming ${project.id}. Expected revision ${params.expectedRevision}, but the current revision is ${recordRevision(project)}.`,
            };
          }
          const plan = executionPlanForProject(project, params.planId);
          if (!plan) {
            return { error: `execution plan not found: ${params.planId}` };
          }
          if (plan.status !== "paused") {
            return {
              error: `execution plan ${plan.id} changed before resume. Review the latest project state.`,
            };
          }
          const nextPlan = transitionPccExecutionPlan(plan, "dispatching", {
            at: nowIso(),
            reason: "Resumed by the PCC operator after a saved pause.",
          });
          return persistStoredPccExecutionPlan(ledger, nextPlan, nextPlan.updatedAt);
        },
        { write: true, auditKind: "pcc.execution.resume" },
      );
      if ("error" in dispatching) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, dispatching.error));
        return;
      }
      const partition = dispatching.plan.partitions[0];
      const taskId = partition?.taskId ?? "";
      const registerRun = (runId: string) => {
        registerPccExecutionRun({
          projectId: dispatching.project.id,
          planId: dispatching.plan.id,
          runId,
          ...(taskId.startsWith("milestone:")
            ? { milestoneId: taskId.slice("milestone:".length) }
            : taskId.startsWith("submilestone:")
              ? { subMilestoneId: taskId.slice("submilestone:".length) }
              : {}),
          model: partition?.modelId ?? "unknown-local-model",
          provider: "local",
          startedAt: dispatching.plan.createdAt,
          broadcast: (projectId, planId) =>
            broadcastPccChanged(context, "pcc.execution.reconcile", projectId, planId),
        });
      };
      registerRun(dispatching.plan.id);
      let acknowledgement: { runId: string; status: string };
      try {
        acknowledgement = await dispatchPccExecutionPlan({
          context,
          client,
          plan: dispatching.plan,
          project: dispatching.project,
          taskTitle: partition?.taskId ?? "the next safe task",
          dispatchKey: `${dispatching.plan.id}:resume:${dispatching.plan.updatedAt}`,
        });
      } catch (error) {
        unregisterPccExecutionRun(dispatching.plan.id);
        const failed = withLedger(
          (ledger) => {
            const project = projectOrError(ledger, params.projectId);
            const plan = project
              ? executionPlanForProject(project, dispatching.plan.id)
              : undefined;
            if (!project || !plan) {
              return { error: "The resumed PCC execution plan was not found." };
            }
            const nextPlan = transitionPccExecutionPlan(plan, "failed", {
              at: nowIso(),
              reason: error instanceof Error ? error.message : String(error),
            });
            return persistStoredPccExecutionPlan(ledger, nextPlan, nextPlan.updatedAt);
          },
          { write: true, auditKind: "pcc.execution.resumeFailed" },
        );
        if ("error" in failed) {
          respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, failed.error));
        } else {
          broadcastPccChanged(context, "pcc.execution.failed", failed.project.id, failed.plan.id);
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.UNAVAILABLE,
              error instanceof Error ? error.message : String(error),
              { retryable: true },
            ),
          );
        }
        return;
      }
      if (acknowledgement.runId !== dispatching.plan.id) {
        unregisterPccExecutionRun(dispatching.plan.id);
      }
      registerRun(acknowledgement.runId);
      const running = withLedger(
        (ledger) => {
          const project = projectOrError(ledger, params.projectId);
          const plan = project ? executionPlanForProject(project, dispatching.plan.id) : undefined;
          if (!project || !plan) {
            return { error: "The resumed PCC execution plan was not found." };
          }
          if (pccExecutionStatusIsTerminal(plan.status)) {
            return { project, plan };
          }
          const nextPlan = {
            ...transitionPccExecutionPlan(plan, "running", {
              at: nowIso(),
              reason: "Verified local coordinator accepted the resumed execution plan.",
            }),
            coordinator: { ...plan.coordinator, runId: acknowledgement.runId },
          };
          return persistStoredPccExecutionPlan(ledger, nextPlan, nextPlan.updatedAt);
        },
        { write: true, auditKind: "pcc.execution.resumed" },
      );
      if ("error" in running) {
        unregisterPccExecutionRun(acknowledgement.runId);
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, running.error));
        return;
      }
      if (pccExecutionStatusIsTerminal(running.plan.status)) {
        unregisterPccExecutionRun(acknowledgement.runId);
      }
      respond(true, { plan: running.plan });
      broadcastPccChanged(context, "pcc.execution.resume", running.project.id, running.plan.id);
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.execution.stop": async ({ params, respond, context, client }) => {
    if (!validatePccExecutionControlParams(params)) {
      respondInvalid(respond, "pcc.execution.stop", validatePccExecutionControlParams.errors);
      return;
    }
    try {
      const target = readPccExecutionControlTarget(params);
      if ("error" in target) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, target.error));
        return;
      }
      if (pccExecutionStatusIsTerminal(target.plan.status)) {
        respond(true, { plan: target.plan });
        return;
      }
      try {
        const aborted = await abortPccExecutionRun({ context, client, plan: target.plan });
        if (!aborted && ["dispatching", "running"].includes(target.plan.status)) {
          throw new Error("The Gateway did not confirm that the active coordinator run stopped.");
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const blocked = markPccExecutionBlockedAfterControlFailure(
          target.project.id,
          target.plan.id,
          `Stop could not be confirmed: ${reason}`,
        );
        if ("error" in blocked) {
          respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, blocked.error));
        } else {
          broadcastPccChanged(
            context,
            "pcc.execution.controlFailed",
            blocked.project.id,
            blocked.plan.id,
          );
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.UNAVAILABLE,
              `PCC execution stop could not be confirmed: ${reason}`,
              { retryable: true },
            ),
          );
        }
        return;
      }
      const result = withLedger(
        (ledger) => {
          const project = projectOrError(ledger, params.projectId);
          if (!project) {
            return { error: `project not found: ${params.projectId}` };
          }
          if (
            params.expectedRevision !== undefined &&
            recordRevision(project) !== params.expectedRevision
          ) {
            return {
              error: `Review latest changes before stopping ${project.id}. Expected revision ${params.expectedRevision}, but the current revision is ${recordRevision(project)}.`,
            };
          }
          const plan = executionPlanForProject(project, params.planId);
          if (!plan) {
            return { error: `execution plan not found: ${params.planId}` };
          }
          if (pccExecutionStatusIsTerminal(plan.status)) {
            return { project, plan };
          }
          const nextPlan = transitionPccExecutionPlan(plan, "cancelled", {
            at: nowIso(),
            reason: "Stopped by the PCC operator.",
          });
          return persistStoredPccExecutionPlan(ledger, nextPlan, nextPlan.updatedAt);
        },
        { write: true, auditKind: "pcc.execution.stop" },
      );
      if ("error" in result) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, result.error));
        return;
      }
      respond(true, { plan: result.plan });
      broadcastPccChanged(context, "pcc.execution.stop", result.project.id, result.plan.id);
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.execution.review": ({ params, respond, context, client }) => {
    if (!validatePccExecutionReviewParams(params)) {
      respondInvalid(respond, "pcc.execution.review", validatePccExecutionReviewParams.errors);
      return;
    }
    try {
      const result = withLedger(
        (ledger) => {
          const project = projectOrError(ledger, params.projectId);
          if (!project) {
            return { error: `project not found: ${params.projectId}` };
          }
          if (
            params.expectedRevision !== undefined &&
            recordRevision(project) !== params.expectedRevision
          ) {
            return {
              error: `Review latest changes before reviewing ${project.id}. Expected revision ${params.expectedRevision}, but the current revision is ${recordRevision(project)}.`,
            };
          }
          const plan = executionPlanForProject(project, params.planId);
          if (!plan) {
            return { error: `execution plan not found: ${params.planId}` };
          }
          const candidate = plan.proofCandidates.find(
            (proofCandidate) => proofCandidate.id === params.proofCandidateId,
          );
          if (!candidate) {
            return { error: `proof candidate not found: ${params.proofCandidateId}` };
          }
          if (candidate.status !== "pending_review") {
            return {
              error: `proof candidate ${candidate.id} was already ${candidate.status}. Review the latest project state.`,
            };
          }
          const reviewedAt = nowIso();
          const reviewer = params.reviewer?.trim() || pccActor(client);
          const nextPlan: PccExecutionPlan = {
            ...plan,
            proofCandidates: plan.proofCandidates.map((proofCandidate) =>
              proofCandidate.id === candidate.id
                ? {
                    ...proofCandidate,
                    status: params.decision === "accept" ? "accepted" : "rejected",
                    reviewedAt,
                    reviewedBy: reviewer,
                    reviewNote:
                      params.decision === "accept"
                        ? "Accepted as a proof candidate; milestone completion remains a separate reviewed action."
                        : "Rejected by PCC operator; milestone completion remains unchanged.",
                  }
                : proofCandidate,
            ),
            updatedAt: reviewedAt,
            auditEvents: [
              ...plan.auditEvents,
              {
                at: reviewedAt,
                status: plan.status,
                reason: `Proof candidate ${params.decision}ed by ${reviewer}.`,
              },
            ].slice(-128),
          };
          return persistStoredPccExecutionPlan(ledger, nextPlan, reviewedAt);
        },
        { write: true, auditKind: "pcc.execution.review" },
      );
      if ("error" in result) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, result.error));
        return;
      }
      respond(true, { plan: result.plan });
      broadcastPccChanged(context, "pcc.execution.review", result.project.id, result.plan.id);
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.attachments.upload.begin": async ({ params, respond }) => {
    if (!validatePccAttachmentsUploadBeginParams(params)) {
      respondInvalid(
        respond,
        "pcc.attachments.upload.begin",
        validatePccAttachmentsUploadBeginParams.errors,
      );
      return;
    }
    try {
      respond(true, await beginPccAttachmentUpload(params));
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.attachments.upload.chunk": async ({ params, respond }) => {
    if (!validatePccAttachmentsUploadChunkParams(params)) {
      respondInvalid(
        respond,
        "pcc.attachments.upload.chunk",
        validatePccAttachmentsUploadChunkParams.errors,
      );
      return;
    }
    try {
      respond(true, await appendPccAttachmentChunk(params));
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.attachments.upload.commit": async ({ params, respond, context }) => {
    if (!validatePccAttachmentsUploadCommitParams(params)) {
      respondInvalid(
        respond,
        "pcc.attachments.upload.commit",
        validatePccAttachmentsUploadCommitParams.errors,
      );
      return;
    }
    try {
      const attachment = await commitPccAttachmentUpload(params);
      respond(true, { attachment });
      broadcastPccChanged(
        context,
        "pcc.attachments.upload.commit",
        attachment.projectId,
        attachment.id,
      );
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.attachments.list": ({ params, respond }) => {
    if (!validatePccAttachmentsListParams(params)) {
      respondInvalid(respond, "pcc.attachments.list", validatePccAttachmentsListParams.errors);
      return;
    }
    try {
      respond(true, {
        attachments: listPccAttachments(params.projectId, {
          includeTombstoned: params.includeTombstoned,
        }),
      });
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.attachments.read": async ({ params, respond }) => {
    if (!validatePccAttachmentsReadParams(params)) {
      respondInvalid(respond, "pcc.attachments.read", validatePccAttachmentsReadParams.errors);
      return;
    }
    try {
      respond(true, await readPccAttachmentChunk(params));
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.attachments.update": ({ params, respond, context }) => {
    if (!validatePccAttachmentsUpdateParams(params)) {
      respondInvalid(respond, "pcc.attachments.update", validatePccAttachmentsUpdateParams.errors);
      return;
    }
    try {
      const attachment = updatePccAttachment(params);
      respond(true, { attachment });
      broadcastPccChanged(context, "pcc.attachments.update", attachment.projectId, attachment.id);
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.attachments.clarify": async ({ params, respond, context }) => {
    if (!validatePccAttachmentsClarifyParams(params)) {
      respondInvalid(
        respond,
        "pcc.attachments.clarify",
        validatePccAttachmentsClarifyParams.errors,
      );
      return;
    }
    try {
      const ledger = readLedger();
      if (!projectOrError(ledger, params.projectId)) {
        respondNotFound(respond, `project ${params.projectId}`);
        return;
      }
      const startedAt = nowIso();
      const result = await clarifyPccAttachmentInstructions({
        cfg: context.getRuntimeConfig(),
        originalName: params.originalName,
        role: params.role,
        instructions: params.instructions,
      });
      withLedger(
        (nextLedger) =>
          recordPccModelRunReceipt(nextLedger, {
            projectId: params.projectId,
            sourceRunId: result.runId,
            executor: "local",
            purpose: "attachment_instruction_clarification",
            provider: result.provenance.provider,
            model: result.provenance.model,
            status: "succeeded",
            startedAt,
            completedAt: result.provenance.generatedAt,
            ...(result.usage ? { usage: result.usage } : {}),
            usageSource: result.usage ? "provider_reported" : "unavailable",
          }),
        { write: true, auditKind: "pcc.attachments.clarify" },
      );
      respond(true, result);
      broadcastPccChanged(context, "pcc.attachments.clarify", params.projectId, result.runId);
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.attachments.usage.record": ({ params, respond, context }) => {
    if (!validatePccAttachmentUsageRecordParams(params)) {
      respondInvalid(
        respond,
        "pcc.attachments.usage.record",
        validatePccAttachmentUsageRecordParams.errors,
      );
      return;
    }
    try {
      const receipt = recordPccAttachmentUsage(params);
      respond(true, { receipt });
      broadcastPccChanged(context, "pcc.attachments.usage.record", receipt.projectId, receipt.id);
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.attachments.usage.list": ({ params, respond }) => {
    if (!validatePccAttachmentUsageListParams(params)) {
      respondInvalid(
        respond,
        "pcc.attachments.usage.list",
        validatePccAttachmentUsageListParams.errors,
      );
      return;
    }
    try {
      respond(true, { receipts: listPccAttachmentUsage(params) });
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.planningPolicy.get": ({ params, respond }) => {
    if (!validatePccPlanningPolicyGetParams(params)) {
      respondInvalid(respond, "pcc.planningPolicy.get", validatePccPlanningPolicyGetParams.errors);
      return;
    }
    try {
      respond(true, {
        policy: resolvePccPlanningPolicy(readLedger().settings?.planningPolicy),
      });
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.planningPolicy.upsert": ({ params, respond, context }) => {
    if (!validatePccPlanningPolicyUpsertParams(params)) {
      respondInvalid(
        respond,
        "pcc.planningPolicy.upsert",
        validatePccPlanningPolicyUpsertParams.errors,
      );
      return;
    }
    try {
      const policy = withLedger(
        (ledger) => {
          const current = normalizePccPlanningPolicy(
            ledger.settings?.planningPolicy ?? DEFAULT_PCC_PLANNING_POLICY,
          );
          const next = normalizePccPlanningPolicy({
            ...current,
            ...(params.depth ? { depth: params.depth } : {}),
            ...(params.model ? { model: params.model } : {}),
            grant: { ...current.grant, enabled: params.enabled },
          });
          ledger.settings = { ...ledger.settings, planningPolicy: next };
          return next;
        },
        { write: true, auditKind: "pcc.planningPolicy.upsert" },
      );
      respond(true, { policy });
      broadcastPccChanged(context, "pcc.planningPolicy.upsert");
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.ledger.repairCanonicalMetadata": ({ params, respond, context }) => {
    try {
      const result = withLedger((ledger) => repairCanonicalMetadataForLedger(ledger, params), {
        write: true,
        auditKind: "pcc.ledger.repairCanonicalMetadata",
      });
      respond(true, result);
      broadcastPccChanged(context, "pcc.ledger.repairCanonicalMetadata");
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.projects.upsert": async ({ params, respond, context, client }) => {
    if (!validatePccProjectsUpsertParams(params)) {
      respondInvalid(respond, "pcc.projects.upsert", validatePccProjectsUpsertParams.errors);
      return;
    }
    try {
      const planningRun = params.planningRunId
        ? await readPccPlanningRun(params.planningRunId)
        : null;
      if (
        params.planningRunId &&
        (!planningRun ||
          planningRun.status !== "succeeded" ||
          !planningRun.startedAt ||
          !planningRun.endedAt)
      ) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "The planning run is not complete and cannot be bound to this project.",
          ),
        );
        return;
      }
      const result = withLedger(
        (ledger) => {
          const upsert = upsertProject(ledger, {
            ...params.project,
            metadata: attributedMetadata(
              params.project.metadata,
              pccActor(client),
              "Project updated",
            ),
            expectedRevision: params.expectedRevision ?? params.project.revision,
          });
          if (upsert.error || !upsert.project) {
            return { error: upsert.error ?? "project upsert failed" };
          }
          if (
            planningRun?.startedAt &&
            planningRun.endedAt &&
            planningRun.plan?.provenance.source === "live_codex"
          ) {
            recordPccModelRunReceipt(ledger, {
              projectId: upsert.project.id,
              sourceRunId: planningRun.id,
              executor: "codex",
              purpose: planningRun.surface === "project_creation" ? "planning" : "replan",
              provider: "openai",
              model: planningRun.model,
              effort: planningRun.effort,
              status: "succeeded",
              startedAt: planningRun.startedAt,
              completedAt: planningRun.endedAt,
              ...(planningRun.usage ? { usage: planningRun.usage } : {}),
              usageSource: planningRun.usage ? "provider_reported" : "unavailable",
            });
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
      broadcastPccChanged(context, "pcc.projects.upsert", result.project.id, result.project.id);
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.projects.commitPlan": async ({ params, respond, context, client }) => {
    if (!validatePccProjectPlanCommitParams(params)) {
      respondInvalid(respond, "pcc.projects.commitPlan", validatePccProjectPlanCommitParams.errors);
      return;
    }
    try {
      const planningRun = params.planningRunId
        ? await readPccPlanningRun(params.planningRunId)
        : null;
      if (
        params.planningRunId &&
        (!planningRun ||
          planningRun.status !== "succeeded" ||
          !planningRun.startedAt ||
          !planningRun.endedAt)
      ) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "The planning run is not complete and cannot be committed.",
          ),
        );
        return;
      }
      const result = withLedger(
        (ledger) => {
          if (params.project.id && projectOrError(ledger, params.project.id)) {
            throw new Error(`project already exists: ${params.project.id}`);
          }
          const projectResult = upsertProject(ledger, {
            ...params.project,
            title: params.project.title || params.plan.title,
            goal: params.project.goal ?? params.plan.goal,
            metadata: attributedMetadata(
              params.project.metadata,
              pccActor(client),
              "Project plan created",
            ),
          });
          if (projectResult.error || !projectResult.project) {
            throw new Error(projectResult.error ?? "project creation failed");
          }
          const project = projectResult.project;
          const milestones: PccMilestone[] = [];
          const subMilestones: PccSubMilestone[] = [];
          for (const [order, generated] of params.plan.milestones.entries()) {
            const dependencyIds = generated.dependencies.flatMap((index) =>
              milestones[index] ? [milestones[index]!.id] : [],
            );
            if (dependencyIds.length !== generated.dependencies.length) {
              throw new Error(`generated milestone ${generated.title} has an invalid dependency`);
            }
            const milestoneResult = upsertMilestone(ledger, {
              projectId: project.id,
              title: generated.title,
              status: "not_started",
              phaseId: generated.phaseId,
              order,
              percentComplete: 0,
              dependsOn: dependencyIds,
              implementationPlan: generated.implementationPlan,
              acceptanceCriteria: generated.acceptanceCriteria,
              metadata: {
                pccResponsibility: generatedExecutionResponsibility(generated.responsibility),
                pccPlannerSuggestedResponsibility: generated.responsibility,
                pccProofLevel: generated.proofLevel,
                pccGeneratedBy: params.plan.provenance.source,
                parallelSafe: generated.dependencies.length === 0,
                pccLastActor: pccActor(client),
                pccLastAction: "Milestone created from project plan",
              },
            });
            if (milestoneResult.error || !milestoneResult.milestone) {
              throw new Error(milestoneResult.error ?? `failed to create ${generated.title}`);
            }
            const repairedMilestone = repairPccExecutionMetadata(
              project.id,
              milestoneResult.milestone,
            );
            const storedMilestone =
              "milestoneId" in repairedMilestone.item
                ? milestoneResult.milestone
                : repairedMilestone.issueCodes.length > 0
                  ? {
                      ...repairedMilestone.item,
                      revision: recordRevision(milestoneResult.milestone) + 1,
                      updatedAt: nowIso(),
                    }
                  : milestoneResult.milestone;
            setAt(ledger.milestones, storedMilestone);
            milestones.push(storedMilestone);
            for (const [subOrder, generatedSub] of generated.subMilestones.entries()) {
              const subResult = upsertSubMilestone(ledger, {
                projectId: project.id,
                milestoneId: milestoneResult.milestone.id,
                title: generatedSub.title,
                status: "not_started",
                order: subOrder,
                percentComplete: 0,
                implementationPlan: generatedSub.implementationPlan,
                acceptanceCriteria: generatedSub.acceptanceCriteria,
                metadata: {
                  pccResponsibility: generatedExecutionResponsibility(generatedSub.responsibility),
                  pccPlannerSuggestedResponsibility: generatedSub.responsibility,
                  pccProofLevel: generatedSub.proofLevel,
                  pccGeneratedBy: params.plan.provenance.source,
                  parallelSafe:
                    generatedExecutionResponsibility(generatedSub.responsibility) !== "user" &&
                    generatedExecutionResponsibility(generatedSub.responsibility) !==
                      "remote_proof",
                  pccLastActor: pccActor(client),
                  pccLastAction: "Sub-milestone created from project plan",
                },
              });
              if (subResult.error || !subResult.subMilestone) {
                throw new Error(subResult.error ?? `failed to create ${generatedSub.title}`);
              }
              const repairedSubMilestone = repairPccExecutionMetadata(
                project.id,
                subResult.subMilestone,
              );
              const storedSubMilestone =
                "milestoneId" in repairedSubMilestone.item
                  ? repairedSubMilestone.issueCodes.length > 0
                    ? {
                        ...repairedSubMilestone.item,
                        revision: recordRevision(subResult.subMilestone) + 1,
                        updatedAt: nowIso(),
                      }
                    : subResult.subMilestone
                  : subResult.subMilestone;
              setAt(ledger.subMilestones, storedSubMilestone);
              subMilestones.push(storedSubMilestone);
            }
          }
          if (
            planningRun?.startedAt &&
            planningRun.endedAt &&
            params.plan.provenance.source === "live_codex"
          ) {
            recordPccModelRunReceipt(ledger, {
              projectId: project.id,
              sourceRunId: planningRun.id,
              executor: "codex",
              purpose: "planning",
              provider: "openai",
              model: planningRun.model,
              effort: planningRun.effort,
              status: "succeeded",
              startedAt: planningRun.startedAt,
              completedAt: planningRun.endedAt,
              ...(planningRun.usage ? { usage: planningRun.usage } : {}),
              usageSource: planningRun.usage ? "provider_reported" : "unavailable",
            });
          }
          return { project, milestones, subMilestones, summary: summarizeProject(ledger, project) };
        },
        { write: true, auditKind: "pcc.projects.commitPlan" },
      );
      respond(true, result);
      broadcastPccChanged(context, "pcc.projects.commitPlan", result.project.id, result.project.id);
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.milestones.upsert": ({ params, respond, context, client }) => {
    if (!validatePccMilestonesUpsertParams(params)) {
      respondInvalid(respond, "pcc.milestones.upsert", validatePccMilestonesUpsertParams.errors);
      return;
    }
    try {
      const result = withLedger(
        (ledger) => {
          const upsert = upsertMilestone(ledger, {
            ...params.milestone,
            ...(params.milestone.replaceExisting !== true
              ? {
                  metadata: attributedMetadata(
                    params.milestone.metadata,
                    pccActor(client),
                    "Milestone updated",
                  ),
                }
              : {}),
            expectedRevision: params.expectedRevision ?? params.milestone.revision,
          });
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
      broadcastPccChanged(
        context,
        "pcc.milestones.upsert",
        result.milestone.projectId,
        result.milestone.id,
      );
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
  "pcc.subMilestones.upsert": ({ params, respond, context, client }) => {
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
          const upsert = upsertSubMilestone(ledger, {
            ...params.subMilestone,
            ...(params.subMilestone.replaceExisting !== true
              ? {
                  metadata: attributedMetadata(
                    params.subMilestone.metadata,
                    pccActor(client),
                    "Sub-milestone updated",
                  ),
                }
              : {}),
            expectedRevision: params.expectedRevision ?? params.subMilestone.revision,
          });
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
      broadcastPccChanged(
        context,
        "pcc.subMilestones.upsert",
        result.subMilestone.projectId,
        result.subMilestone.id,
      );
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.permissions.upsert": ({ params, respond, context, client }) => {
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
          const conflict = revisionConflict(
            existing,
            params.expectedRevision ?? params.permission.revision,
          );
          if (conflict) {
            return { error: conflict };
          }
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
              actor: pccActor(client),
              ...(params.permission.note ? { note: params.permission.note } : {}),
            },
          ].slice(-200);
          const permission: PccPermissionGrant = {
            id:
              existing?.id ?? params.permission.id ?? makeId("permission", params.permission.type),
            revision: nextRecordRevision(existing),
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
      broadcastPccChanged(
        context,
        "pcc.permissions.upsert",
        result.permission.projectId,
        result.permission.id,
      );
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.evidence.add": ({ params, respond, context }) => {
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
      broadcastPccChanged(
        context,
        "pcc.evidence.add",
        result.evidence.projectId,
        result.evidence.id,
      );
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.decisions.add": ({ params, respond, context }) => {
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
      broadcastPccChanged(
        context,
        "pcc.decisions.add",
        result.decision.projectId,
        result.decision.id,
      );
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.receipts.add": ({ params, respond, context }) => {
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
            revision: recordRevision(milestone) + 1,
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
      broadcastPccChanged(context, "pcc.receipts.add", result.receipt.projectId, result.receipt.id);
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.lastKnownGood.upsert": ({ params, respond, context }) => {
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
      broadcastPccChanged(
        context,
        "pcc.lastKnownGood.upsert",
        result.lastKnownGood.projectId,
        result.lastKnownGood.id,
      );
    } catch (error) {
      respondUnhandled(respond, error);
    }
  },
  "pcc.summary.get": async ({ params, respond, context }) => {
    if (!validatePccSummaryGetParams(params)) {
      respondInvalid(respond, "pcc.summary.get", validatePccSummaryGetParams.errors);
      return;
    }
    try {
      const ledger = readLedger();
      const index = buildPccLedgerReadIndex(ledger);
      const executionCapacity = await readPccExecutionCapacity(context.getRuntimeConfig());
      if (params.projectId) {
        const project = projectOrError(ledger, params.projectId);
        if (!project) {
          respondNotFound(respond, `project ${params.projectId}`);
          return;
        }
        respond(true, {
          project: summarizeProject(ledger, project, index),
          portfolio: summarizePortfolio(ledger, index),
          planningPolicy: resolvePccPlanningPolicy(ledger.settings?.planningPolicy),
          privateTeamPolicy: normalizePccPrivateTeamPolicy(ledger.settings?.privateTeamPolicy),
          executionCapacity,
          runtimeIdentity: readPccRuntimeIdentity(),
          updateSafety: readPccUpdateSafety(),
          releaseGovernance: readReleaseGovernanceStatus(),
        });
        return;
      }
      respond(true, {
        portfolio: summarizePortfolio(ledger, index),
        planningPolicy: resolvePccPlanningPolicy(ledger.settings?.planningPolicy),
        privateTeamPolicy: normalizePccPrivateTeamPolicy(ledger.settings?.privateTeamPolicy),
        executionCapacity,
        runtimeIdentity: readPccRuntimeIdentity(),
        updateSafety: readPccUpdateSafety(),
        releaseGovernance: readReleaseGovernanceStatus(),
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
  readExecutionCapacity: readPccExecutionCapacity,
  setPlanGenerator: (generator: typeof generatePccPlan) => {
    pccPlanGenerator = generator;
  },
  resetPlanGenerator: () => {
    pccPlanGenerator = generatePccPlan;
    resetPccPlanningRunsForTest();
    resetPccPresenceForTest();
  },
};

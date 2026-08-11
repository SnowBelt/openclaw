// PCC production-truth helpers summarize proof state without changing runtime gates.
import type {
  PccCompletionReceipt,
  PccEvidence,
  PccMilestone,
  PccProject,
  PccStatus,
} from "../../packages/gateway-protocol/src/schema/types.js";
import { pccResponsibilityForItem } from "./metadata.js";

export type PccProductionTruthStatus =
  | "current"
  | "stale"
  | "proof_missing"
  | "needs_repair"
  | "blocked";

export type PccProductionTruthInput = {
  project?: PccProject | null;
  milestones?: readonly PccMilestone[];
  evidence?: readonly PccEvidence[];
  receipts?: readonly PccCompletionReceipt[];
  latestVerifiedBranch?: string | null;
  latestVerifiedSha?: string | null;
  runtimeSha?: string | null;
  remoteProofSha?: string | null;
  runtimeProofSha?: string | null;
  browserProofSha?: string | null;
  remoteProofPassed?: boolean;
  runtimeProofPassed?: boolean;
  browserProofScreenshotPath?: string | null;
  runtimeEntrypoint?: string | null;
  expectedRuntimeRoot?: string | null;
  gatewayConfigAuditOk?: boolean | null;
  runtimeDriftReason?: string | null;
  blockedReason?: string | null;
};

export type PccProductionTruthSummary = {
  status: PccProductionTruthStatus;
  label: string;
  latestVerifiedBranch: string | null;
  latestVerifiedSha: string | null;
  runtimeSha: string | null;
  remoteProofPassed: boolean;
  runtimeProofPassed: boolean;
  browserProofScreenshotPath: string | null;
  runtimeEntrypoint: string | null;
  expectedRuntimeRoot: string | null;
  gatewayConfigAuditOk: boolean | null;
  runtimeDriftReason: string | null;
  currentRemoteProofEvidenceIds: string[];
  currentRuntimeProofEvidenceIds: string[];
  currentBrowserProofEvidenceIds: string[];
  proofRecordedAt: string | null;
  proofGaps: string[];
  completedMilestones: string[];
  missingReceiptMilestones: string[];
  remoteProofRequired: string[];
  runtimeProofRequired: string[];
  missingEvidenceReferences: string[];
  historicalEvidenceGaps: string[];
  doNotRedoNotes: string[];
  blockedReason: string | null;
};

const COMPLETE_STATUSES = new Set<PccStatus>(["complete", "complete_with_maintenance"]);
const REMOTE_PROOF_STATUSES = new Set(["remote_ci", "remote_workflow_sanity"]);
const RUNTIME_PROOF_STATUSES = new Set([
  "runtime_status",
  "browser_proof",
  "authenticated_browser_proof",
  "screenshot",
]);

function metadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function metadataString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function metadataBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function pathTextIsSameOrChild(candidate: string, parent: string): boolean {
  const normalizedCandidate = candidate.replaceAll("\\", "/").replace(/\/+$/u, "");
  const normalizedParent = parent.replaceAll("\\", "/").replace(/\/+$/u, "");
  return (
    normalizedCandidate === normalizedParent ||
    normalizedCandidate.startsWith(`${normalizedParent}/`)
  );
}

function projectTruthMetadata(project?: PccProject | null): Record<string, unknown> {
  return metadataObject(metadataObject(project?.metadata).pccProductionTruth);
}

export type PccProductionTruthRepair = {
  project: PccProject;
  changes: string[];
};

/**
 * Converts legacy truth flags into the SHA-bound fields required by the current
 * production-truth contract. This intentionally only binds already-recorded
 * successful proof; it never invents a proof flag or runtime SHA.
 */
export function repairPccProductionTruthBindings(
  project: PccProject,
  updatedAt = project.updatedAt,
): PccProductionTruthRepair {
  const metadata = metadataObject(project.metadata);
  const truth = metadataObject(metadata.pccProductionTruth);
  const nextTruth = { ...truth };
  const changes: string[] = [];
  const remotePassed = metadataBoolean(truth.remoteProofPassed) === true;
  const runtimePassed = metadataBoolean(truth.runtimeProofPassed) === true;
  const latestVerifiedSha = metadataString(truth.latestVerifiedSha);
  const runtimeSha = metadataString(truth.runtimeSha);
  const browserScreenshot = metadataString(truth.browserProofScreenshotPath);

  if (remotePassed && latestVerifiedSha && !metadataString(truth.remoteProofSha)) {
    nextTruth.remoteProofSha = latestVerifiedSha;
    changes.push("Bound the recorded remote proof to the verified source SHA.");
  }
  if (runtimePassed && runtimeSha && !metadataString(truth.runtimeProofSha)) {
    nextTruth.runtimeProofSha = runtimeSha;
    changes.push("Bound the recorded runtime proof to the active runtime SHA.");
  }
  if (runtimePassed && runtimeSha && browserScreenshot && !metadataString(truth.browserProofSha)) {
    nextTruth.browserProofSha = runtimeSha;
    changes.push("Bound the recorded browser proof to the active runtime SHA.");
  }
  if (changes.length === 0) {
    return { project, changes };
  }
  nextTruth.updatedAt = updatedAt;
  return {
    project: {
      ...project,
      updatedAt,
      metadata: { ...metadata, pccProductionTruth: nextTruth },
    },
    changes,
  };
}

function milestoneNeedsRemoteProof(milestone: PccMilestone): boolean {
  const metadata = metadataObject(milestone.metadata);
  return (
    metadata.requiresRemoteProof === true ||
    metadata.pccProofLevel === "remote" ||
    pccResponsibilityForItem(milestone) === "remote_proof"
  );
}

function milestoneNeedsRuntimeProof(milestone: PccMilestone): boolean {
  const metadata = metadataObject(milestone.metadata);
  return metadata.requiresRuntimeProof === true || metadata.pccProofLevel === "runtime";
}

function evidenceKindMatches(evidence: PccEvidence, allowedKinds: ReadonlySet<string>): boolean {
  return evidence.status === "passed" && allowedKinds.has(evidence.kind);
}

function evidenceMatchesSha(
  evidence: PccEvidence,
  allowedKinds: ReadonlySet<string>,
  sha: string | null,
): boolean {
  return Boolean(sha) && evidenceKindMatches(evidence, allowedKinds) && evidence.sha === sha;
}

function latestEvidenceSha(
  evidence: readonly PccEvidence[],
  allowedKinds: ReadonlySet<string>,
): string | null {
  return (
    evidence
      .filter((entry) => evidenceKindMatches(entry, allowedKinds) && metadataString(entry.sha))
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0]?.sha ?? null
  );
}

function latestEvidenceTimestamp(evidence: readonly PccEvidence[]): string | null {
  return (
    evidence.toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
      ?.createdAt ?? null
  );
}

function milestoneHasEvidence(
  milestone: PccMilestone,
  evidence: readonly PccEvidence[],
  allowedKinds: ReadonlySet<string>,
): boolean {
  return evidence.some(
    (entry) => entry.milestoneId === milestone.id && evidenceKindMatches(entry, allowedKinds),
  );
}

export function buildPccProductionTruth(input: PccProductionTruthInput): PccProductionTruthSummary {
  const meta = projectTruthMetadata(input.project);
  const milestones = input.milestones ?? [];
  const receipts = input.receipts ?? [];
  const evidence = input.evidence ?? [];
  const latestVerifiedBranch =
    input.latestVerifiedBranch ?? metadataString(meta.latestVerifiedBranch);
  const latestVerifiedSha =
    input.latestVerifiedSha ??
    metadataString(meta.latestVerifiedSha) ??
    latestEvidenceSha(evidence, REMOTE_PROOF_STATUSES);
  const runtimeSha = input.runtimeSha ?? metadataString(meta.runtimeSha);
  const remoteProofSha = input.remoteProofSha ?? metadataString(meta.remoteProofSha);
  const runtimeProofSha = input.runtimeProofSha ?? metadataString(meta.runtimeProofSha);
  const browserProofSha = input.browserProofSha ?? metadataString(meta.browserProofSha);
  const browserProofScreenshotPath =
    input.browserProofScreenshotPath ?? metadataString(meta.browserProofScreenshotPath);
  const runtimeEntrypoint = input.runtimeEntrypoint ?? metadataString(meta.runtimeEntrypoint);
  const expectedRuntimeRoot =
    input.expectedRuntimeRoot ??
    metadataString(meta.expectedRuntimeRoot) ??
    metadataString(meta.runtimeRoot);
  const gatewayConfigAuditOk =
    input.gatewayConfigAuditOk ?? metadataBoolean(meta.gatewayConfigAuditOk);
  const runtimeDriftReason =
    input.runtimeDriftReason ??
    metadataString(meta.runtimeDriftReason) ??
    metadataString(meta.gatewayRuntimeDriftReason);
  const blockedReason = input.blockedReason ?? metadataString(meta.blockedReason);
  const currentRemoteProofEvidence = evidence.filter((entry) =>
    evidenceMatchesSha(entry, REMOTE_PROOF_STATUSES, latestVerifiedSha),
  );
  const currentRuntimeProofEvidence = evidence.filter((entry) =>
    evidenceMatchesSha(entry, RUNTIME_PROOF_STATUSES, runtimeSha),
  );
  const currentBrowserProofEvidence = evidence.filter((entry) =>
    evidenceMatchesSha(entry, new Set(["browser_proof", "screenshot"]), runtimeSha),
  );
  const remoteProofPassed =
    currentRemoteProofEvidence.length > 0 ||
    ((input.remoteProofPassed ?? metadataBoolean(meta.remoteProofPassed) ?? false) &&
      Boolean(remoteProofSha) &&
      remoteProofSha === latestVerifiedSha);
  const runtimeProofPassed =
    currentRuntimeProofEvidence.length > 0 ||
    ((input.runtimeProofPassed ?? metadataBoolean(meta.runtimeProofPassed) ?? false) &&
      Boolean(runtimeProofSha) &&
      runtimeProofSha === runtimeSha);
  const browserProofPassed =
    currentBrowserProofEvidence.length > 0 ||
    (Boolean(browserProofScreenshotPath) &&
      Boolean(browserProofSha) &&
      browserProofSha === runtimeSha &&
      runtimeProofPassed);
  const completedMilestones = milestones
    .filter((milestone) => COMPLETE_STATUSES.has(milestone.status))
    .map((milestone) => milestone.title);
  const missingReceiptMilestones = milestones
    .filter((milestone) => COMPLETE_STATUSES.has(milestone.status))
    .filter((milestone) => !receipts.some((receipt) => receipt.milestoneId === milestone.id))
    .map((milestone) => milestone.title);
  const remoteProofRequired = milestones
    .filter(milestoneNeedsRemoteProof)
    .filter((milestone) => !milestoneHasEvidence(milestone, evidence, REMOTE_PROOF_STATUSES))
    .map((milestone) => milestone.title);
  const runtimeProofRequired = milestones
    .filter(milestoneNeedsRuntimeProof)
    .filter((milestone) => !milestoneHasEvidence(milestone, evidence, RUNTIME_PROOF_STATUSES))
    .map((milestone) => milestone.title);
  const evidenceIds = new Set(evidence.map((entry) => entry.id));
  const missingEvidenceReferences = receipts.flatMap((receipt) =>
    (receipt.proofEvidenceIds ?? [])
      .filter((evidenceId) => !evidenceIds.has(evidenceId))
      .map(
        (evidenceId) => `Receipt ${receipt.id} references missing proof evidence: ${evidenceId}`,
      ),
  );
  const historicalEvidenceGaps = missingEvidenceReferences.map(
    (reference) => `Historical evidence cleanup: ${reference}`,
  );
  const entrypointDrift =
    runtimeEntrypoint &&
    expectedRuntimeRoot &&
    !pathTextIsSameOrChild(runtimeEntrypoint, expectedRuntimeRoot)
      ? `Gateway service entrypoint is outside the verified runtime: ${runtimeEntrypoint}`
      : null;
  const doNotRedoNotes = receipts.flatMap((receipt) => receipt.doNotRedo ?? []).slice(0, 8);
  const proofGaps = [
    ...missingReceiptMilestones.map((title) => `Receipt missing: ${title}`),
    ...remoteProofRequired.map((title) => `Remote proof missing: ${title}`),
    ...runtimeProofRequired.map((title) => `Runtime proof missing: ${title}`),
    ...(!latestVerifiedSha ? ["PCC verified source SHA is missing"] : []),
    ...(!runtimeSha ? ["Active Gateway runtime SHA is missing"] : []),
    ...(!remoteProofPassed
      ? ["PCC remote Workflow Sanity proof is missing or is not bound to the verified SHA"]
      : []),
    ...(!runtimeProofPassed
      ? ["PCC runtime proof is missing or is not bound to the active runtime SHA"]
      : []),
    ...(!browserProofPassed
      ? ["PCC browser proof is missing or is not bound to the active runtime SHA"]
      : []),
    ...(runtimeSha && latestVerifiedSha && runtimeSha !== latestVerifiedSha
      ? [
          `Runtime SHA ${runtimeSha.slice(0, 12)} does not match verified ${latestVerifiedSha.slice(0, 12)}`,
        ]
      : []),
    ...(entrypointDrift ? [entrypointDrift] : []),
    ...(runtimeDriftReason ? [`Gateway runtime drift: ${runtimeDriftReason}`] : []),
    ...(gatewayConfigAuditOk === false ? ["Gateway config audit failed"] : []),
  ];
  const status: PccProductionTruthStatus = blockedReason
    ? "blocked"
    : entrypointDrift || runtimeDriftReason || gatewayConfigAuditOk === false
      ? "needs_repair"
      : runtimeSha && latestVerifiedSha && runtimeSha !== latestVerifiedSha
        ? "stale"
        : proofGaps.length > 0
          ? "proof_missing"
          : "current";
  const label =
    status === "current"
      ? "Current"
      : status === "stale"
        ? "Stale"
        : status === "needs_repair"
          ? "Needs repair"
          : status === "blocked"
            ? "Blocked"
            : "Proof missing";

  return {
    status,
    label,
    latestVerifiedBranch,
    latestVerifiedSha,
    runtimeSha,
    remoteProofPassed,
    runtimeProofPassed,
    browserProofScreenshotPath,
    runtimeEntrypoint,
    expectedRuntimeRoot,
    gatewayConfigAuditOk,
    runtimeDriftReason,
    currentRemoteProofEvidenceIds: currentRemoteProofEvidence.map((entry) => entry.id),
    currentRuntimeProofEvidenceIds: currentRuntimeProofEvidence.map((entry) => entry.id),
    currentBrowserProofEvidenceIds: currentBrowserProofEvidence.map((entry) => entry.id),
    proofRecordedAt: latestEvidenceTimestamp([
      ...currentRemoteProofEvidence,
      ...currentRuntimeProofEvidence,
      ...currentBrowserProofEvidence,
    ]),
    proofGaps,
    completedMilestones,
    missingReceiptMilestones,
    remoteProofRequired,
    runtimeProofRequired,
    missingEvidenceReferences,
    historicalEvidenceGaps,
    doNotRedoNotes,
    blockedReason,
  };
}

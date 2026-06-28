// PCC production-truth helpers summarize proof state without changing runtime gates.
import type {
  PccCompletionReceipt,
  PccEvidence,
  PccMilestone,
  PccProject,
  PccStatus,
} from "../../packages/gateway-protocol/src/schema/types.js";

export const PCC_LATEST_VERIFIED_BRANCH = "codex/pcc-portfolio-orchestration-v1-20260627";
export const PCC_LATEST_VERIFIED_SHA = "4d8408034d7131470980c316a2af2f311aa6b785";

export type PccProductionTruthStatus = "current" | "stale" | "proof_missing" | "blocked";

export type PccProductionTruthInput = {
  project?: PccProject | null;
  milestones?: readonly PccMilestone[];
  evidence?: readonly PccEvidence[];
  receipts?: readonly PccCompletionReceipt[];
  latestVerifiedBranch?: string;
  latestVerifiedSha?: string;
  runtimeSha?: string | null;
  remoteProofPassed?: boolean;
  runtimeProofPassed?: boolean;
  browserProofScreenshotPath?: string | null;
  blockedReason?: string | null;
};

export type PccProductionTruthSummary = {
  status: PccProductionTruthStatus;
  label: string;
  latestVerifiedBranch: string;
  latestVerifiedSha: string;
  runtimeSha: string | null;
  remoteProofPassed: boolean;
  runtimeProofPassed: boolean;
  browserProofScreenshotPath: string | null;
  proofGaps: string[];
  completedMilestones: string[];
  missingReceiptMilestones: string[];
  remoteProofRequired: string[];
  runtimeProofRequired: string[];
  doNotRedoNotes: string[];
  blockedReason: string | null;
};

const COMPLETE_STATUSES = new Set<PccStatus>(["complete", "complete_with_maintenance"]);
const REMOTE_PROOF_STATUSES = new Set(["remote_ci"]);
const RUNTIME_PROOF_STATUSES = new Set(["runtime_status", "browser_proof", "screenshot"]);

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

function projectTruthMetadata(project?: PccProject | null): Record<string, unknown> {
  return metadataObject(metadataObject(project?.metadata).pccProductionTruth);
}

function milestoneNeedsRemoteProof(milestone: PccMilestone): boolean {
  const metadata = metadataObject(milestone.metadata);
  return (
    metadata.requiresRemoteProof === true ||
    metadata.pccProofLevel === "remote" ||
    metadata.pccResponsibility === "remote_proof"
  );
}

function milestoneNeedsRuntimeProof(milestone: PccMilestone): boolean {
  const metadata = metadataObject(milestone.metadata);
  return metadata.requiresRuntimeProof === true || metadata.pccProofLevel === "runtime";
}

function evidenceKindMatches(evidence: PccEvidence, allowedKinds: ReadonlySet<string>): boolean {
  return evidence.status === "passed" && allowedKinds.has(evidence.kind);
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
  const latestVerifiedBranch =
    input.latestVerifiedBranch ??
    metadataString(meta.latestVerifiedBranch) ??
    PCC_LATEST_VERIFIED_BRANCH;
  const latestVerifiedSha =
    input.latestVerifiedSha ?? metadataString(meta.latestVerifiedSha) ?? PCC_LATEST_VERIFIED_SHA;
  const runtimeSha = input.runtimeSha ?? metadataString(meta.runtimeSha);
  const remoteProofPassed =
    input.remoteProofPassed ?? metadataBoolean(meta.remoteProofPassed) ?? false;
  const runtimeProofPassed =
    input.runtimeProofPassed ?? metadataBoolean(meta.runtimeProofPassed) ?? false;
  const browserProofScreenshotPath =
    input.browserProofScreenshotPath ?? metadataString(meta.browserProofScreenshotPath);
  const blockedReason = input.blockedReason ?? metadataString(meta.blockedReason);
  const milestones = input.milestones ?? [];
  const receipts = input.receipts ?? [];
  const evidence = input.evidence ?? [];
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
  const doNotRedoNotes = receipts.flatMap((receipt) => receipt.doNotRedo ?? []).slice(0, 8);
  const proofGaps = [
    ...missingReceiptMilestones.map((title) => `Receipt missing: ${title}`),
    ...remoteProofRequired.map((title) => `Remote proof missing: ${title}`),
    ...runtimeProofRequired.map((title) => `Runtime proof missing: ${title}`),
    ...(!remoteProofPassed ? ["PCC remote Workflow Sanity proof missing"] : []),
    ...(!runtimeProofPassed ? ["PCC live runtime/browser proof missing"] : []),
    ...(runtimeSha && runtimeSha !== latestVerifiedSha
      ? [
          `Runtime SHA ${runtimeSha.slice(0, 12)} does not match verified ${latestVerifiedSha.slice(0, 12)}`,
        ]
      : []),
  ];
  const status: PccProductionTruthStatus = blockedReason
    ? "blocked"
    : runtimeSha && runtimeSha !== latestVerifiedSha
      ? "stale"
      : proofGaps.length > 0
        ? "proof_missing"
        : "current";
  const label =
    status === "current"
      ? "Current"
      : status === "stale"
        ? "Stale"
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
    proofGaps,
    completedMilestones,
    missingReceiptMilestones,
    remoteProofRequired,
    runtimeProofRequired,
    doNotRedoNotes,
    blockedReason,
  };
}

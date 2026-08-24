import { createHash } from "node:crypto";
import type {
  PccCompletionReceipt,
  PccEvidence,
  PccProject,
} from "../../../packages/gateway-protocol/src/schema/types.js";
import { readPccLedgerSnapshot, withPccLedger } from "../ledger-store.js";
import { browserProofCheckId, proofProfileVersion } from "./browser-proof-contract.js";
import {
  RELEASE_LEDGER_PREFLIGHT_SCHEMA,
  type ReleaseEvidenceBundle,
  type ReleaseLedgerPreflightReceipt,
} from "./contracts.js";
import { verifyReleaseEvidenceBundle } from "./evidence.js";

export type ReleaseLedgerRecordResult = {
  evidenceId: string;
  receiptId: string;
  evidenceAdded: boolean;
  receiptAdded: boolean;
  browserEvidenceId?: string;
  browserEvidenceAdded?: boolean;
  productionTruthBound?: boolean;
};

const LOCAL_PROOF_PROFILE = "mac_studio_control_director";
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export const RELEASE_LEDGER_PROJECT_ID = "project-command-center";
export const RELEASE_LEDGER_MILESTONE_ID = "release-governor";
const PCC_PROJECT_ID = RELEASE_LEDGER_PROJECT_ID;

type ReleaseLedgerPreflightInput = Omit<ReleaseLedgerPreflightReceipt, "receiptHash">;

function releaseLedgerPreflightJson(input: ReleaseLedgerPreflightInput): string {
  const canonical: ReleaseLedgerPreflightInput = {
    schema: input.schema,
    candidateSha: input.candidateSha,
    projectId: input.projectId,
    milestoneId: input.milestoneId,
    ledgerRevision: input.ledgerRevision,
    checkedAt: input.checkedAt,
  };
  return `${JSON.stringify(canonical, null, 2)}\n`;
}

export function releaseLedgerPreflightHash(input: ReleaseLedgerPreflightInput): string {
  return createHash("sha256").update(releaseLedgerPreflightJson(input)).digest("hex");
}

export function createReleaseLedgerPreflightReceipt(params: {
  candidateSha: string;
  env?: NodeJS.ProcessEnv;
  now?: string;
}): ReleaseLedgerPreflightReceipt {
  if (!/^[a-f0-9]{40}$/u.test(params.candidateSha)) {
    throw new Error("Release ledger preflight requires an exact 40-character candidate SHA.");
  }
  const env = params.env ?? process.env;
  const snapshot = readPccLedgerSnapshot(env);
  const { ledger } = snapshot;
  if (!ledger.projects.some((project) => project.id === RELEASE_LEDGER_PROJECT_ID)) {
    throw new Error(`Release ledger project does not exist: ${RELEASE_LEDGER_PROJECT_ID}.`);
  }
  if (
    !ledger.milestones.some(
      (milestone) =>
        milestone.projectId === RELEASE_LEDGER_PROJECT_ID &&
        milestone.id === RELEASE_LEDGER_MILESTONE_ID,
    )
  ) {
    throw new Error(
      `Release ledger milestone does not exist in project ${RELEASE_LEDGER_PROJECT_ID}: ${RELEASE_LEDGER_MILESTONE_ID}.`,
    );
  }
  const revision = snapshot.revision;
  if (revision === null) {
    throw new Error("Release ledger preflight requires the canonical revisioned SQLite ledger.");
  }
  const input: ReleaseLedgerPreflightInput = {
    schema: RELEASE_LEDGER_PREFLIGHT_SCHEMA,
    candidateSha: params.candidateSha,
    projectId: RELEASE_LEDGER_PROJECT_ID,
    milestoneId: RELEASE_LEDGER_MILESTONE_ID,
    ledgerRevision: revision,
    checkedAt: params.now ?? new Date().toISOString(),
  };
  return { ...input, receiptHash: releaseLedgerPreflightHash(input) };
}

export function verifyReleaseLedgerPreflightReceipt(params: {
  receipt: ReleaseLedgerPreflightReceipt;
  candidateSha: string;
  projectId: string;
  milestoneId: string;
}): string[] {
  const errors: string[] = [];
  const { receipt } = params;
  if (receipt.schema !== RELEASE_LEDGER_PREFLIGHT_SCHEMA) {
    errors.push(`Unsupported release ledger preflight schema: ${String(receipt.schema)}.`);
  }
  if (receipt.candidateSha !== params.candidateSha) {
    errors.push("Release ledger preflight SHA does not match the exact candidate SHA.");
  }
  if (receipt.projectId !== params.projectId || receipt.projectId !== RELEASE_LEDGER_PROJECT_ID) {
    errors.push("Release ledger preflight project is not the canonical Release Governor project.");
  }
  if (
    receipt.milestoneId !== params.milestoneId ||
    receipt.milestoneId !== RELEASE_LEDGER_MILESTONE_ID
  ) {
    errors.push(
      "Release ledger preflight milestone is not the canonical Release Governor milestone.",
    );
  }
  if (!Number.isSafeInteger(receipt.ledgerRevision) || receipt.ledgerRevision < 1) {
    errors.push("Release ledger preflight revision is invalid.");
  }
  if (!Number.isFinite(Date.parse(receipt.checkedAt))) {
    errors.push("Release ledger preflight timestamp is invalid.");
  }
  const { receiptHash, ...input } = receipt;
  const expectedHash = releaseLedgerPreflightHash(input);
  if (receiptHash !== expectedHash) {
    errors.push(`Release ledger preflight hash mismatch: expected ${expectedHash}.`);
  }
  return errors;
}

type LocalPostDeploymentBrowserBinding = {
  evidence: PccEvidence;
  proofProfileVersion: number;
  browserArtifactPath: string;
  browserArtifactSha256: string;
  verifierSha256: string;
  receiptArtifactSha256: string;
};

function browserEvidenceMatches(existing: PccEvidence, expected: PccEvidence): boolean {
  const actualMetadata = metadataObject(existing.metadata);
  const expectedMetadata = metadataObject(expected.metadata);
  const actualRuntimeIdentity = metadataObject(actualMetadata.pccRuntimeIdentity);
  const expectedRuntimeIdentity = metadataObject(expectedMetadata.pccRuntimeIdentity);
  return (
    existing.id === expected.id &&
    existing.projectId === expected.projectId &&
    existing.milestoneId === expected.milestoneId &&
    existing.kind === expected.kind &&
    existing.status === expected.status &&
    existing.summary === expected.summary &&
    existing.source === expected.source &&
    existing.sha === expected.sha &&
    existing.path === expected.path &&
    existing.command === expected.command &&
    existing.createdAt === expected.createdAt &&
    actualMetadata.receiptHash === expectedMetadata.receiptHash &&
    actualMetadata.proofProfile === expectedMetadata.proofProfile &&
    actualMetadata.proofProfileVersion === expectedMetadata.proofProfileVersion &&
    actualMetadata.proofPhase === expectedMetadata.proofPhase &&
    actualMetadata.browserArtifactSha256 === expectedMetadata.browserArtifactSha256 &&
    actualMetadata.verifierSha256 === expectedMetadata.verifierSha256 &&
    actualMetadata.receiptArtifactSha256 === expectedMetadata.receiptArtifactSha256 &&
    actualMetadata.pccProductionSourceProof === expectedMetadata.pccProductionSourceProof &&
    actualRuntimeIdentity.activeRuntimeSha === expectedRuntimeIdentity.activeRuntimeSha &&
    actualRuntimeIdentity.candidateRuntimeSha === expectedRuntimeIdentity.candidateRuntimeSha
  );
}

function metadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function recordRevision(record: { revision?: number }): number {
  return typeof record.revision === "number" && Number.isInteger(record.revision)
    ? record.revision
    : 0;
}

function setProject(ledger: { projects: PccProject[] }, project: PccProject): void {
  const index = ledger.projects.findIndex((entry) => entry.id === project.id);
  if (index === -1) {
    ledger.projects.push(project);
  } else {
    ledger.projects[index] = project;
  }
}

function browserEvidenceId(bundle: ReleaseEvidenceBundle): string {
  return `${releaseEvidenceId(bundle)}-post-deployment-browser`;
}

function requiredChecksArePassed(bundle: ReleaseEvidenceBundle): boolean {
  const checks = new Map(bundle.checks.map((check) => [check.id, check.status]));
  return bundle.evaluation.classification.requiredChecks.every(
    (checkId) => checks.get(checkId) === "passed",
  );
}

function localPostDeploymentBrowserBinding(
  bundle: ReleaseEvidenceBundle,
): LocalPostDeploymentBrowserBinding | null {
  if (
    bundle.proofProfile !== LOCAL_PROOF_PROFILE ||
    bundle.facts.proofProfile !== LOCAL_PROOF_PROFILE ||
    bundle.proofPhase !== "post_deployment" ||
    bundle.facts.proofPhase !== "post_deployment"
  ) {
    return null;
  }
  if (bundle.ledger.projectId !== PCC_PROJECT_ID) {
    throw new Error("Local post-deployment PCC truth binding requires project-command-center.");
  }
  if (
    bundle.evaluation.classification.proofProfile !== LOCAL_PROOF_PROFILE ||
    bundle.evaluation.classification.proofPhase !== "post_deployment" ||
    bundle.evaluation.decision.proofProfile !== LOCAL_PROOF_PROFILE ||
    bundle.evaluation.decision.proofPhase !== "post_deployment" ||
    bundle.evaluation.decision.operation !== "finalize"
  ) {
    throw new Error(
      "Local post-deployment PCC truth binding has inconsistent proof authorization.",
    );
  }
  if (!requiredChecksArePassed(bundle)) {
    throw new Error(
      "Local post-deployment PCC truth binding requires every authorized check to pass.",
    );
  }
  if (
    bundle.runtime.activeRuntimeSha !== bundle.facts.candidateSha ||
    bundle.runtime.candidateRuntimeSha !== bundle.facts.candidateSha
  ) {
    throw new Error(
      "Local post-deployment PCC truth binding requires exact active and candidate SHA equality.",
    );
  }
  if (!bundle.browserProof.postDeployment || bundle.browserProof.consoleErrors !== 0) {
    throw new Error(
      "Release evidence cannot bind PCC production truth without a hash-bound local post-deployment browser proof.",
    );
  }
  if (bundle.browserProof.candidate === bundle.browserProof.postDeployment) {
    throw new Error(
      "Candidate browser evidence must remain separate from post-deployment browser evidence.",
    );
  }
  const checkId = browserProofCheckId(LOCAL_PROOF_PROFILE, "post_deployment");
  const check = bundle.checks.find((entry) => entry.id === checkId);
  const browserArtifactPath = bundle.browserProof.postDeployment.trim();
  const checkArtifactPath = check?.artifact?.trim() ?? "";
  const browserArtifactSha256 = check?.browserArtifactSha256 ?? "";
  const verifierSha256 = check?.verifierSha256 ?? "";
  const receiptArtifactSha256 = check?.artifactSha256 ?? "";
  if (
    !check ||
    check.status !== "passed" ||
    !check.command?.trim() ||
    !browserArtifactPath ||
    checkArtifactPath !== browserArtifactPath ||
    check.proofPhase !== "post_deployment" ||
    check.proofProfileVersion !== proofProfileVersion(LOCAL_PROOF_PROFILE) ||
    !SHA256_PATTERN.test(browserArtifactSha256) ||
    !SHA256_PATTERN.test(verifierSha256) ||
    !SHA256_PATTERN.test(receiptArtifactSha256)
  ) {
    throw new Error(
      "Release evidence cannot bind PCC production truth without a hash-bound local post-deployment browser proof.",
    );
  }
  return {
    proofProfileVersion: check.proofProfileVersion,
    browserArtifactPath,
    browserArtifactSha256,
    verifierSha256,
    receiptArtifactSha256,
    evidence: {
      id: browserEvidenceId(bundle),
      projectId: bundle.ledger.projectId,
      milestoneId: bundle.ledger.milestoneId,
      kind: "browser_proof",
      status: "passed",
      summary: `Authenticated local post-deployment PCC browser proof passed for ${bundle.facts.candidateSha}.`,
      source: "PCC Release Governor",
      path: browserArtifactPath,
      sha: bundle.facts.candidateSha,
      command: check.command,
      createdAt: check.recordedAt,
      metadata: {
        receiptHash: bundle.receiptHash,
        proofProfile: LOCAL_PROOF_PROFILE,
        proofProfileVersion: check.proofProfileVersion,
        proofPhase: "post_deployment",
        browserArtifactSha256,
        verifierSha256,
        receiptArtifactSha256,
        pccProductionSourceProof: true,
        pccRuntimeIdentity: {
          activeRuntimeSha: bundle.runtime.activeRuntimeSha,
          candidateRuntimeSha: bundle.runtime.candidateRuntimeSha,
        },
      },
    },
  };
}

function bindPccProductionTruth(
  project: PccProject,
  bundle: ReleaseEvidenceBundle,
  binding: LocalPostDeploymentBrowserBinding,
  evidenceId: string,
  receiptId: string,
  deployedAt: string,
): PccProject {
  const metadata = metadataObject(project.metadata);
  const previousTruth = metadataObject(metadata.pccProductionTruth);
  const proofEvidenceIds = [evidenceId, binding.evidence.id];
  const nextTruth = {
    ...previousTruth,
    proofProfile: LOCAL_PROOF_PROFILE,
    proofProfileVersion: binding.proofProfileVersion,
    proofPhase: "post_deployment",
    latestVerifiedSha: bundle.facts.candidateSha,
    sourceProofSha: bundle.facts.candidateSha,
    sourceProofPassed: true,
    runtimeSha: bundle.runtime.activeRuntimeSha,
    runtimeProofSha: bundle.runtime.activeRuntimeSha,
    runtimeProofPassed: true,
    browserProofSha: bundle.runtime.activeRuntimeSha,
    browserProofScreenshotPath: binding.browserArtifactPath,
    proofArtifactSha256: binding.browserArtifactSha256,
    proofVerifierSha256: binding.verifierSha256,
    browserProofArtifactSha256: binding.browserArtifactSha256,
    browserProofVerifierSha256: binding.verifierSha256,
    proofReceiptArtifactSha256: binding.receiptArtifactSha256,
    pccRuntimeIdentity: {
      activeRuntimeSha: bundle.runtime.activeRuntimeSha,
      candidateRuntimeSha: bundle.runtime.candidateRuntimeSha,
    },
    proofEvidenceIds,
    releaseEvidenceReceiptHash: bundle.receiptHash,
    releaseEvidenceReceiptId: receiptId,
    productionCurrent: true,
    noProofGaps: true,
    finalized: true,
    finalizedAt: deployedAt,
    updatedAt: deployedAt,
  };
  return {
    ...project,
    revision: recordRevision(project) + 1,
    updatedAt: deployedAt,
    metadata: { ...metadata, pccProductionTruth: nextTruth },
  };
}

function releaseEvidenceId(bundle: ReleaseEvidenceBundle): string {
  return `release-governor-${bundle.receiptHash}`;
}

function releaseReceiptId(bundle: ReleaseEvidenceBundle): string {
  return `release-governor-receipt-${bundle.receiptHash}`;
}

export function recordReleaseEvidenceInPccLedger(
  bundle: ReleaseEvidenceBundle,
  env: NodeJS.ProcessEnv = process.env,
): ReleaseLedgerRecordResult {
  const bundleErrors = verifyReleaseEvidenceBundle(bundle);
  if (bundleErrors.length > 0) {
    throw new Error(`Release evidence bundle is not hash-bound: ${bundleErrors.join(" ")}`);
  }
  if (bundle.evaluation.decision.decision !== "authorize") {
    throw new Error("Release evidence cannot be recorded as complete unless policy authorized it.");
  }
  if (!bundle.ledger.ready || !bundle.deployment.deployedAt) {
    throw new Error("Release evidence is not production-complete or ledger-ready.");
  }
  const deployedAt = bundle.deployment.deployedAt;
  if (!bundle.deployment.postDeploymentHealth?.passed) {
    throw new Error("Release evidence cannot be completed without passing post-deployment health.");
  }
  const evidenceId = releaseEvidenceId(bundle);
  const receiptId = releaseReceiptId(bundle);
  const productionTruthBrowserEvidenceId = browserEvidenceId(bundle);
  return withPccLedger(
    (ledger) => {
      const project = ledger.projects.find((entry) => entry.id === bundle.ledger.projectId);
      if (!project) {
        throw new Error(`Release evidence project does not exist: ${bundle.ledger.projectId}.`);
      }
      const milestone = ledger.milestones.find(
        (entry) =>
          entry.id === bundle.ledger.milestoneId && entry.projectId === bundle.ledger.projectId,
      );
      if (!milestone) {
        throw new Error(
          `Release evidence milestone does not exist in project ${bundle.ledger.projectId}: ${bundle.ledger.milestoneId}.`,
        );
      }
      const browserBinding = localPostDeploymentBrowserBinding(bundle);
      const evidenceAdded = !ledger.evidence.some((entry) => entry.id === evidenceId);
      if (evidenceAdded) {
        const evidence: PccEvidence = {
          id: evidenceId,
          projectId: bundle.ledger.projectId,
          milestoneId: bundle.ledger.milestoneId,
          kind: "receipt",
          status: "passed",
          summary: `Release Governor authorized ${bundle.evaluation.decision.operation} for ${bundle.facts.candidateSha}.`,
          source: "PCC Release Governor",
          sha: bundle.facts.candidateSha,
          createdAt: bundle.createdAt,
          metadata: {
            receiptHash: bundle.receiptHash,
            policyVersion: bundle.evaluation.decision.policyVersion,
            proofProfile: bundle.facts.proofProfile,
            proofPhase: bundle.facts.proofPhase,
            riskLevel: bundle.evaluation.classification.riskLevel,
            decision: bundle.evaluation.decision.decision,
            approvalMode: bundle.evaluation.decision.approvalMode,
          },
        };
        ledger.evidence.push(evidence);
      }
      const browserEvidenceAdded = browserBinding
        ? !ledger.evidence.some((entry) => entry.id === productionTruthBrowserEvidenceId)
        : false;
      const existingBrowserEvidence = browserBinding
        ? ledger.evidence.find((entry) => entry.id === productionTruthBrowserEvidenceId)
        : undefined;
      if (
        browserBinding &&
        existingBrowserEvidence &&
        !browserEvidenceMatches(existingBrowserEvidence, browserBinding.evidence)
      ) {
        throw new Error(
          "Release evidence cannot reuse a mismatched PCC post-deployment browser proof.",
        );
      }
      if (browserBinding && browserEvidenceAdded) {
        ledger.evidence.push(browserBinding.evidence);
      }
      const existingReceipt = ledger.receipts.find((entry) => entry.id === receiptId);
      const receiptAdded = !existingReceipt;
      if (receiptAdded) {
        const receipt: PccCompletionReceipt = {
          id: receiptId,
          projectId: bundle.ledger.projectId,
          milestoneId: bundle.ledger.milestoneId,
          summary: `Release ${bundle.facts.candidateSha} is policy-authorized, deployed, healthy, and evidence-bound.`,
          proofEvidenceIds: [
            evidenceId,
            ...(browserBinding ? [productionTruthBrowserEvidenceId] : []),
          ],
          artifactRefs: Object.values(bundle.build.artifactHashes),
          doNotRedo: [`Release Governor evidence ${bundle.receiptHash}`],
          followUpGaps: [],
          proofLevel: "production",
          completedBy: "PCC Release Governor",
          completedAt: deployedAt,
        };
        ledger.receipts.push(receipt);
      } else if (
        browserBinding &&
        !existingReceipt.proofEvidenceIds.includes(productionTruthBrowserEvidenceId)
      ) {
        existingReceipt.proofEvidenceIds = [
          ...existingReceipt.proofEvidenceIds,
          productionTruthBrowserEvidenceId,
        ];
      }
      let productionTruthBound = false;
      if (browserBinding) {
        const truth = metadataObject(metadataObject(project.metadata).pccProductionTruth);
        const truthRuntimeIdentity = metadataObject(truth.pccRuntimeIdentity);
        const truthProofEvidenceIds: unknown[] = Array.isArray(truth.proofEvidenceIds)
          ? truth.proofEvidenceIds
          : [];
        const alreadyBound =
          truth.proofProfile === LOCAL_PROOF_PROFILE &&
          truth.proofProfileVersion === browserBinding.proofProfileVersion &&
          truth.proofPhase === "post_deployment" &&
          truth.latestVerifiedSha === bundle.facts.candidateSha &&
          truth.runtimeSha === bundle.runtime.activeRuntimeSha &&
          truth.runtimeProofSha === bundle.runtime.activeRuntimeSha &&
          truth.browserProofSha === bundle.runtime.activeRuntimeSha &&
          truth.browserProofScreenshotPath === browserBinding.browserArtifactPath &&
          truth.proofArtifactSha256 === browserBinding.browserArtifactSha256 &&
          truth.proofVerifierSha256 === browserBinding.verifierSha256 &&
          truth.browserProofArtifactSha256 === browserBinding.browserArtifactSha256 &&
          truth.browserProofVerifierSha256 === browserBinding.verifierSha256 &&
          truth.proofReceiptArtifactSha256 === browserBinding.receiptArtifactSha256 &&
          truthRuntimeIdentity.activeRuntimeSha === bundle.runtime.activeRuntimeSha &&
          truthRuntimeIdentity.candidateRuntimeSha === bundle.runtime.candidateRuntimeSha &&
          truthProofEvidenceIds.length === 2 &&
          truthProofEvidenceIds[0] === evidenceId &&
          truthProofEvidenceIds[1] === productionTruthBrowserEvidenceId &&
          truth.releaseEvidenceReceiptHash === bundle.receiptHash &&
          truth.releaseEvidenceReceiptId === receiptId &&
          truth.productionCurrent === true &&
          truth.noProofGaps === true &&
          truth.finalized === true;
        if (!alreadyBound) {
          setProject(
            ledger,
            bindPccProductionTruth(
              project,
              bundle,
              browserBinding,
              evidenceId,
              receiptId,
              deployedAt,
            ),
          );
          productionTruthBound = true;
        }
      }
      return {
        evidenceId,
        receiptId,
        evidenceAdded,
        receiptAdded,
        ...(browserBinding
          ? {
              browserEvidenceId: productionTruthBrowserEvidenceId,
              browserEvidenceAdded,
              productionTruthBound,
            }
          : {}),
      };
    },
    { write: true, auditKind: "release_governor_receipt" },
    env,
  );
}

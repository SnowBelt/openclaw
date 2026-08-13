import { createHash } from "node:crypto";
import type {
  PccCompletionReceipt,
  PccEvidence,
} from "../../../packages/gateway-protocol/src/schema/types.js";
import { readPccLedgerSnapshot, withPccLedger } from "../ledger-store.js";
import {
  RELEASE_LEDGER_PREFLIGHT_SCHEMA,
  type ReleaseEvidenceBundle,
  type ReleaseLedgerPreflightReceipt,
} from "./contracts.js";

export const RELEASE_LEDGER_PROJECT_ID = "project-command-center";
export const RELEASE_LEDGER_MILESTONE_ID = "release-governor";

type ReleaseLedgerPreflightInput = Omit<ReleaseLedgerPreflightReceipt, "receiptHash">;

export type ReleaseLedgerRecordResult = {
  evidenceId: string;
  receiptId: string;
  evidenceAdded: boolean;
  receiptAdded: boolean;
};

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
      const receiptAdded = !ledger.receipts.some((entry) => entry.id === receiptId);
      if (receiptAdded) {
        const receipt: PccCompletionReceipt = {
          id: receiptId,
          projectId: bundle.ledger.projectId,
          milestoneId: bundle.ledger.milestoneId,
          summary: `Release ${bundle.facts.candidateSha} is policy-authorized, deployed, healthy, and evidence-bound.`,
          proofEvidenceIds: [evidenceId],
          artifactRefs: Object.values(bundle.build.artifactHashes),
          doNotRedo: [`Release Governor evidence ${bundle.receiptHash}`],
          followUpGaps: [],
          proofLevel: "production",
          completedBy: "PCC Release Governor",
          completedAt: deployedAt,
        };
        ledger.receipts.push(receipt);
      }
      return { evidenceId, receiptId, evidenceAdded, receiptAdded };
    },
    { write: true, auditKind: "release_governor_receipt" },
    env,
  );
}

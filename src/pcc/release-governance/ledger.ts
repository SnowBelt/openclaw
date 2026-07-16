import type {
  PccCompletionReceipt,
  PccEvidence,
} from "../../../packages/gateway-protocol/src/schema/types.js";
import { withPccLedger } from "../ledger-store.js";
import type { ReleaseEvidenceBundle } from "./contracts.js";

export type ReleaseLedgerRecordResult = {
  evidenceId: string;
  receiptId: string;
  evidenceAdded: boolean;
  receiptAdded: boolean;
};

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

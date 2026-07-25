import type { PccLedger } from "./domain/ledger.js";

const PCC_PROJECT_ID = "project-command-center";
const RELEASE_GOVERNOR_MILESTONE_ID = "pcc-production-governor-runtime-proof";

type LegacyReceipt = {
  evidenceIds?: unknown;
};

export type PccLedgerIntegrityRepair = {
  changes: string[];
};

function stringIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

/**
 * Canonicalizes known legacy PCC receipt links and repairs Release Governor
 * records that predate fail-closed milestone validation. It never invents
 * evidence or changes completion status.
 */
export function repairPccLedgerIntegrity(ledger: PccLedger): PccLedgerIntegrityRepair {
  const changes: string[] = [];
  const milestoneIds = new Set(
    ledger.milestones
      .filter((milestone) => milestone.projectId === PCC_PROJECT_ID)
      .map((milestone) => milestone.id),
  );
  const evidenceById = new Map(ledger.evidence.map((evidence) => [evidence.id, evidence]));

  for (const receipt of ledger.receipts) {
    if (receipt.projectId !== PCC_PROJECT_ID) {
      continue;
    }
    if ((receipt.proofEvidenceIds?.length ?? 0) === 0) {
      const legacyIds = stringIds((receipt as unknown as LegacyReceipt).evidenceIds);
      const canonicalIds = legacyIds.filter((id) => {
        const evidence = evidenceById.get(id);
        return evidence?.projectId === PCC_PROJECT_ID && evidence.status === "passed";
      });
      if (canonicalIds.length > 0) {
        receipt.proofEvidenceIds = [...new Set(canonicalIds)];
        changes.push(`Canonicalized legacy proof evidence for receipt ${receipt.id}.`);
      }
    }
  }

  if (!milestoneIds.has(RELEASE_GOVERNOR_MILESTONE_ID)) {
    return { changes };
  }
  for (const evidence of ledger.evidence) {
    if (
      evidence.projectId === PCC_PROJECT_ID &&
      evidence.source === "PCC Release Governor" &&
      evidence.milestoneId &&
      !milestoneIds.has(evidence.milestoneId)
    ) {
      evidence.milestoneId = RELEASE_GOVERNOR_MILESTONE_ID;
      changes.push(`Rebound Release Governor evidence ${evidence.id}.`);
    }
  }
  for (const receipt of ledger.receipts) {
    if (
      receipt.projectId === PCC_PROJECT_ID &&
      receipt.id.startsWith("release-governor-receipt-") &&
      !milestoneIds.has(receipt.milestoneId)
    ) {
      receipt.milestoneId = RELEASE_GOVERNOR_MILESTONE_ID;
      changes.push(`Rebound Release Governor receipt ${receipt.id}.`);
    }
  }
  return { changes };
}

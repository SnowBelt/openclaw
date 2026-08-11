import type {
  PccCompletionReceipt,
  PccDecision,
  PccEvidence,
  PccLastKnownGood,
  PccMilestone,
  PccPermissionGrant,
  PccSubMilestone,
} from "../../../packages/gateway-protocol/src/schema/types.js";
import type { PccLedger } from "../domain/ledger.js";

export type PccLedgerReadIndex = {
  milestonesById: ReadonlyMap<string, PccMilestone>;
  milestonesByProjectId: ReadonlyMap<string, readonly PccMilestone[]>;
  subMilestonesById: ReadonlyMap<string, PccSubMilestone>;
  subMilestonesByMilestoneId: ReadonlyMap<string, readonly PccSubMilestone[]>;
  subMilestonesByProjectId: ReadonlyMap<string, readonly PccSubMilestone[]>;
  mismatchedSubMilestonesByParentProjectId: ReadonlyMap<string, readonly PccSubMilestone[]>;
  permissionsByProjectId: ReadonlyMap<string, readonly PccPermissionGrant[]>;
  evidenceById: ReadonlyMap<string, PccEvidence>;
  evidenceByProjectId: ReadonlyMap<string, readonly PccEvidence[]>;
  receiptsByMilestoneId: ReadonlyMap<string, readonly PccCompletionReceipt[]>;
  receiptsByProjectId: ReadonlyMap<string, readonly PccCompletionReceipt[]>;
  decisionsByProjectId: ReadonlyMap<string, readonly PccDecision[]>;
  lastKnownGoodByProjectId: ReadonlyMap<string, readonly PccLastKnownGood[]>;
};

const EMPTY_INDEX_ITEMS: readonly never[] = [];

export function pccIndexedItems<T>(
  groups: ReadonlyMap<string, readonly T[]>,
  key: string,
): readonly T[] {
  return groups.get(key) ?? EMPTY_INDEX_ITEMS;
}

function appendToGroup<T>(groups: Map<string, T[]>, key: string, value: T): void {
  const existing = groups.get(key);
  if (existing) {
    existing.push(value);
  } else {
    groups.set(key, [value]);
  }
}

export function buildPccLedgerReadIndex(ledger: PccLedger): PccLedgerReadIndex {
  const milestonesById = new Map<string, PccMilestone>();
  const milestonesByProjectId = new Map<string, PccMilestone[]>();
  const milestoneProjectIdsById = new Map<string, Set<string>>();
  for (const milestone of ledger.milestones) {
    if (!milestonesById.has(milestone.id)) {
      milestonesById.set(milestone.id, milestone);
    }
    appendToGroup(milestonesByProjectId, milestone.projectId, milestone);
    const projectIds = milestoneProjectIdsById.get(milestone.id);
    if (projectIds) {
      projectIds.add(milestone.projectId);
    } else {
      milestoneProjectIdsById.set(milestone.id, new Set([milestone.projectId]));
    }
  }

  const subMilestonesById = new Map<string, PccSubMilestone>();
  const subMilestonesByMilestoneId = new Map<string, PccSubMilestone[]>();
  const subMilestonesByProjectId = new Map<string, PccSubMilestone[]>();
  for (const subMilestone of ledger.subMilestones) {
    if (!subMilestonesById.has(subMilestone.id)) {
      subMilestonesById.set(subMilestone.id, subMilestone);
    }
    appendToGroup(subMilestonesByMilestoneId, subMilestone.milestoneId, subMilestone);
    appendToGroup(subMilestonesByProjectId, subMilestone.projectId, subMilestone);
  }
  const mismatchedSubMilestonesByParentProjectId = new Map<string, PccSubMilestone[]>();
  for (const subMilestone of ledger.subMilestones) {
    for (const parentProjectId of milestoneProjectIdsById.get(subMilestone.milestoneId) ?? []) {
      if (parentProjectId !== subMilestone.projectId) {
        appendToGroup(mismatchedSubMilestonesByParentProjectId, parentProjectId, subMilestone);
      }
    }
  }

  const permissionsByProjectId = new Map<string, PccPermissionGrant[]>();
  for (const permission of ledger.permissions) {
    appendToGroup(permissionsByProjectId, permission.projectId, permission);
  }

  const evidenceById = new Map<string, PccEvidence>();
  const evidenceByProjectId = new Map<string, PccEvidence[]>();
  for (const evidence of ledger.evidence) {
    if (!evidenceById.has(evidence.id)) {
      evidenceById.set(evidence.id, evidence);
    }
    appendToGroup(evidenceByProjectId, evidence.projectId, evidence);
  }

  const receiptsByMilestoneId = new Map<string, PccCompletionReceipt[]>();
  const receiptsByProjectId = new Map<string, PccCompletionReceipt[]>();
  for (const receipt of ledger.receipts) {
    appendToGroup(receiptsByMilestoneId, receipt.milestoneId, receipt);
    appendToGroup(receiptsByProjectId, receipt.projectId, receipt);
  }

  const decisionsByProjectId = new Map<string, PccDecision[]>();
  for (const decision of ledger.decisions) {
    appendToGroup(decisionsByProjectId, decision.projectId, decision);
  }

  const lastKnownGoodByProjectId = new Map<string, PccLastKnownGood[]>();
  for (const entry of ledger.lastKnownGood) {
    appendToGroup(lastKnownGoodByProjectId, entry.projectId, entry);
  }

  return {
    milestonesById,
    milestonesByProjectId,
    subMilestonesById,
    subMilestonesByMilestoneId,
    subMilestonesByProjectId,
    mismatchedSubMilestonesByParentProjectId,
    permissionsByProjectId,
    evidenceById,
    evidenceByProjectId,
    receiptsByMilestoneId,
    receiptsByProjectId,
    decisionsByProjectId,
    lastKnownGoodByProjectId,
  };
}

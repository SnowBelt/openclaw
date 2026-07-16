import type {
  PccCompletionReceipt,
  PccDecision,
  PccEvidence,
  PccLastKnownGood,
  PccMilestone,
  PccPermissionGrant,
  PccProject,
  PccSubMilestone,
} from "../../../packages/gateway-protocol/src/schema/types.js";

/**
 * Storage-independent PCC aggregate consumed by domain and read-model services.
 * Persistence adapters may serialize this shape, but do not own its contract.
 */
export type PccLedger = {
  version: 1;
  projects: PccProject[];
  milestones: PccMilestone[];
  subMilestones: PccSubMilestone[];
  permissions: PccPermissionGrant[];
  evidence: PccEvidence[];
  receipts: PccCompletionReceipt[];
  decisions: PccDecision[];
  lastKnownGood: PccLastKnownGood[];
};

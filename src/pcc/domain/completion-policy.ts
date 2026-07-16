import type {
  PccMilestone,
  PccStatus,
  PccSubMilestone,
} from "../../../packages/gateway-protocol/src/schema/types.js";

const COMPLETE_STATUSES = new Set<PccStatus>(["complete", "complete_with_maintenance"]);
const BLOCKED_STATUSES = new Set<PccStatus>(["blocked", "failed"]);
const WAITING_STATUSES = new Set<PccStatus>(["needs_approval", "deferred", "on_hold"]);
const SKIPPED_STATUSES = new Set<PccStatus>(["skipped", "archived"]);

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

export function isPccCompleteStatus(status: PccStatus): boolean {
  return COMPLETE_STATUSES.has(status);
}

export function isPccBlockedStatus(status: PccStatus): boolean {
  return BLOCKED_STATUSES.has(status);
}

export function isPccWaitingStatus(status: PccStatus): boolean {
  return WAITING_STATUSES.has(status);
}

export function isPccSkippedStatus(status: PccStatus): boolean {
  return SKIPPED_STATUSES.has(status);
}

export function isPccTerminalStatus(status: PccStatus): boolean {
  return isPccCompleteStatus(status) || isPccSkippedStatus(status);
}

export function pccSubMilestonePercent(subMilestone: PccSubMilestone): number {
  if (isPccSkippedStatus(subMilestone.status)) {
    return 0;
  }
  if (isPccCompleteStatus(subMilestone.status)) {
    return 100;
  }
  if (typeof subMilestone.percentComplete === "number") {
    return Math.max(0, Math.min(99, subMilestone.percentComplete));
  }
  return PARTIAL_STATUS_PERCENT[subMilestone.status] ?? 0;
}

export function pccSubMilestonesAreComplete(subMilestones: readonly PccSubMilestone[]): boolean {
  return subMilestones
    .filter((subMilestone) => !isPccSkippedStatus(subMilestone.status))
    .every((subMilestone) => isPccCompleteStatus(subMilestone.status));
}

export function pccMilestonePercent(input: {
  milestone: PccMilestone;
  subMilestones: readonly PccSubMilestone[];
  hasCompletionReceipt: boolean;
}): number {
  const { milestone, subMilestones, hasCompletionReceipt } = input;
  if (isPccSkippedStatus(milestone.status)) {
    return 0;
  }
  if (isPccCompleteStatus(milestone.status) && hasCompletionReceipt) {
    return 100;
  }
  if (subMilestones.length > 0) {
    return Math.round(
      subMilestones.reduce((total, subMilestone) => {
        return total + pccSubMilestonePercent(subMilestone);
      }, 0) / subMilestones.length,
    );
  }
  if (typeof milestone.percentComplete === "number") {
    return Math.max(0, Math.min(99, milestone.percentComplete));
  }
  return PARTIAL_STATUS_PERCENT[milestone.status] ?? 0;
}

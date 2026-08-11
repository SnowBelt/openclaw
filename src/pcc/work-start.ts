import type {
  PccCompletionReceipt,
  PccMilestone,
  PccPermissionGrant,
  PccProject,
  PccSubMilestone,
} from "../../packages/gateway-protocol/src/schema/types.js";
import type { PccCapabilityInventoryEntry } from "./capability-contract.js";
import { evaluatePccProjectSetup } from "./intake-quality.js";
import { getPccWorkLoopNext } from "./work-loop.js";

export type PccWorkStartInput = {
  project: PccProject;
  milestones: readonly PccMilestone[];
  subMilestones?: readonly PccSubMilestone[];
  permissions?: readonly PccPermissionGrant[];
  receipts?: readonly PccCompletionReceipt[];
  capabilityInventory?: readonly PccCapabilityInventoryEntry[];
};

function metadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function setupMetadataLooksPassing(project: PccProject): boolean {
  const metadata = metadataObject(project.metadata);
  const qualityGate = metadataObject(metadata.pccQualityGate);
  const setupScore = metadataObject(metadata.pccSetupScore);
  return qualityGate.status === "passing" && setupScore.runnable === true;
}

function pushUnique(items: string[], value: string | undefined): void {
  const trimmed = value?.trim();
  if (trimmed && !items.includes(trimmed)) {
    items.push(trimmed);
  }
}

export function buildPccWorkStartBlockers(input: PccWorkStartInput): string[] {
  const setup = evaluatePccProjectSetup({
    project: input.project,
    milestones: input.milestones,
    subMilestones: input.subMilestones ?? [],
  });
  const blockers: string[] = [];

  if (!setup.runnable) {
    if (setupMetadataLooksPassing(input.project)) {
      pushUnique(blockers, "Setup metadata is stale. PCC can repair it.");
    }
    for (const issue of [...setup.missing, ...setup.violations, ...setup.needsReview].slice(
      0,
      10,
    )) {
      pushUnique(blockers, issue);
    }
  }

  if (input.project.status === "on_hold") {
    pushUnique(blockers, "Project is on hold. Resume it before starting supervised work.");
  }

  const next = getPccWorkLoopNext(input);
  pushUnique(blockers, next.blocker?.message);

  return blockers.slice(0, 12);
}

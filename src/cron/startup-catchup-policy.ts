import type { CronJob } from "./types.js";

export type StartupCatchupReliabilityDecision = {
  action: "run" | "skip" | "approval_required" | "legacy_compatibility";
  reason:
    | "contract_allows_catch_up"
    | "contract_skips_catch_up"
    | "contract_requires_approval"
    | "unsafe_automatic_side_effect"
    | "no_contract";
};

/** Resolves only restart catch-up authority; normal on-time cron execution is unchanged. */
export function resolveStartupCatchupReliabilityDecision(
  job: Pick<CronJob, "reliability">,
): StartupCatchupReliabilityDecision {
  const contract = job.reliability;
  if (!contract) {
    return { action: "legacy_compatibility", reason: "no_contract" };
  }
  if (contract.catchUpPolicy === "skip") {
    return { action: "skip", reason: "contract_skips_catch_up" };
  }
  if (contract.catchUpPolicy === "manual" || contract.approvalClass !== "automatic") {
    return { action: "approval_required", reason: "contract_requires_approval" };
  }
  if (contract.sideEffectClass === "external_irreversible") {
    return { action: "approval_required", reason: "unsafe_automatic_side_effect" };
  }
  return { action: "run", reason: "contract_allows_catch_up" };
}

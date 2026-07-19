// Bounded, reversible repair policy for Control Director runtime hygiene.
import type { ControlDirectorJourneySignalCode } from "./control-director-journeys.js";

export const CONTROL_DIRECTOR_SELF_HEALING_POLICY_VERSION = 1 as const;
export const CONTROL_DIRECTOR_SELF_HEALING_COOLDOWN_MS = 15 * 60 * 1_000;
export const CONTROL_DIRECTOR_SELF_HEALING_MAX_ATTEMPTS = 2;

export type ControlDirectorRepairAction =
  | "reconcile_stale_goal"
  | "retry_terminal_delivery"
  | "rebuild_memory_index"
  | "refresh_session_title";

const ALLOWLIST: Partial<Record<ControlDirectorJourneySignalCode, ControlDirectorRepairAction>> = {
  stalled_goal: "reconcile_stale_goal",
  delivery_miss: "retry_terminal_delivery",
  memory_miss: "rebuild_memory_index",
  title_failure: "refresh_session_title",
};

export type ControlDirectorSelfHealingDecision =
  | {
      allowed: true;
      schemaVersion: typeof CONTROL_DIRECTOR_SELF_HEALING_POLICY_VERSION;
      action: ControlDirectorRepairAction;
      targetId: string;
      nextAttempt: number;
      auditRequired: true;
      rollbackRequired: true;
    }
  | {
      allowed: false;
      code:
        | "not_allowlisted"
        | "action_mismatch"
        | "not_reversible"
        | "missing_rollback"
        | "missing_evidence"
        | "invalid_target"
        | "cooldown"
        | "attempt_limit";
      reason: string;
      escalate: boolean;
    };

/** Authorize policy only; the owning subsystem performs and audits the repair. */
export function evaluateControlDirectorSelfHealing(params: {
  signalCode: ControlDirectorJourneySignalCode;
  action: string;
  targetId: string;
  reversible: boolean;
  rollbackRef?: string;
  evidenceRefs?: readonly string[];
  previousAttempts?: number;
  lastAttemptAt?: number;
  now?: number;
}): ControlDirectorSelfHealingDecision {
  const expected = ALLOWLIST[params.signalCode];
  if (!expected) {
    return {
      allowed: false,
      code: "not_allowlisted",
      reason: `Signal ${params.signalCode} has no automatic repair authority.`,
      escalate: true,
    };
  }
  if (params.action !== expected) {
    return {
      allowed: false,
      code: "action_mismatch",
      reason: `Signal ${params.signalCode} may only request ${expected}.`,
      escalate: true,
    };
  }
  if (!params.reversible) {
    return {
      allowed: false,
      code: "not_reversible",
      reason: "Repair is not reversible.",
      escalate: true,
    };
  }
  if (!params.rollbackRef?.trim()) {
    return {
      allowed: false,
      code: "missing_rollback",
      reason: "Rollback evidence is required.",
      escalate: true,
    };
  }
  if (!params.evidenceRefs?.some((entry) => entry.trim())) {
    return {
      allowed: false,
      code: "missing_evidence",
      reason: "Observed-failure evidence is required.",
      escalate: true,
    };
  }
  const targetId = params.targetId.trim();
  if (!targetId || targetId === "*" || targetId.length > 240) {
    return {
      allowed: false,
      code: "invalid_target",
      reason: "Repair target must be exact and bounded.",
      escalate: true,
    };
  }
  const attempts = Math.max(0, Math.floor(params.previousAttempts ?? 0));
  if (attempts >= CONTROL_DIRECTOR_SELF_HEALING_MAX_ATTEMPTS) {
    return {
      allowed: false,
      code: "attempt_limit",
      reason: "Repair attempt limit reached.",
      escalate: true,
    };
  }
  const now = params.now ?? Date.now();
  if (
    params.lastAttemptAt !== undefined &&
    now - params.lastAttemptAt < CONTROL_DIRECTOR_SELF_HEALING_COOLDOWN_MS
  ) {
    return {
      allowed: false,
      code: "cooldown",
      reason: "Repair cooldown is active.",
      escalate: false,
    };
  }
  return {
    allowed: true,
    schemaVersion: CONTROL_DIRECTOR_SELF_HEALING_POLICY_VERSION,
    action: expected,
    targetId,
    nextAttempt: attempts + 1,
    auditRequired: true,
    rollbackRequired: true,
  };
}

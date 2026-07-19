import { describe, expect, it } from "vitest";
import {
  CONTROL_DIRECTOR_SELF_HEALING_COOLDOWN_MS,
  evaluateControlDirectorSelfHealing,
} from "./control-director-self-healing.js";

const safe = {
  signalCode: "stalled_goal" as const,
  action: "reconcile_stale_goal",
  targetId: "flow-1",
  reversible: true,
  rollbackRef: "snapshot:flow-1:revision-4",
  evidenceRefs: ["diagnostic:signal-1"],
  now: 1_000_000,
};

describe("Control Director bounded self-healing", () => {
  it("admits only the exact reversible, evidenced, rollback-bound repair", () => {
    expect(evaluateControlDirectorSelfHealing(safe)).toMatchObject({
      allowed: true,
      action: "reconcile_stale_goal",
      targetId: "flow-1",
      nextAttempt: 1,
      auditRequired: true,
      rollbackRequired: true,
    });
  });

  it.each([
    ["deploy", "action_mismatch"],
    ["modify_config", "action_mismatch"],
    ["switch_model", "action_mismatch"],
    ["publish", "action_mismatch"],
  ])("denies unrelated mutation %s", (action, code) => {
    expect(evaluateControlDirectorSelfHealing({ ...safe, action })).toMatchObject({
      allowed: false,
      code,
      escalate: true,
    });
  });

  it("enforces reversibility, rollback, evidence, cooldown, and attempt ceilings", () => {
    expect(evaluateControlDirectorSelfHealing({ ...safe, reversible: false })).toMatchObject({
      code: "not_reversible",
    });
    expect(evaluateControlDirectorSelfHealing({ ...safe, rollbackRef: "" })).toMatchObject({
      code: "missing_rollback",
    });
    expect(evaluateControlDirectorSelfHealing({ ...safe, evidenceRefs: [] })).toMatchObject({
      code: "missing_evidence",
    });
    expect(
      evaluateControlDirectorSelfHealing({
        ...safe,
        lastAttemptAt: safe.now - CONTROL_DIRECTOR_SELF_HEALING_COOLDOWN_MS + 1,
      }),
    ).toMatchObject({ code: "cooldown", escalate: false });
    expect(evaluateControlDirectorSelfHealing({ ...safe, previousAttempts: 2 })).toMatchObject({
      code: "attempt_limit",
      escalate: true,
    });
  });

  it("keeps SIG recommendation-only for non-runtime-hygiene signals", () => {
    expect(
      evaluateControlDirectorSelfHealing({
        ...safe,
        signalCode: "completion_without_proof",
        action: "approve_completion",
      }),
    ).toMatchObject({ allowed: false, code: "not_allowlisted", escalate: true });
  });
});

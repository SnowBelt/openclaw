import { describe, expect, it } from "vitest";
import {
  CUSTOM_RUNTIME_UPDATE_PREPARATION_RUNNING_REASON,
  CUSTOM_RUNTIME_UPDATE_EXACT_SHA_APPROVAL_REQUIRED_REASON,
  CUSTOM_RUNTIME_UPDATE_SAFETY_BLOCKED_REASON,
  assertCustomRuntimeUpdateCanApprove,
  assertCustomRuntimeUpdateCanPrepare,
} from "./custom-runtime-update-broker.js";
import type { CustomRuntimeUpdatePolicy } from "./custom-runtime-update-policy.js";

function policy(overrides: Partial<CustomRuntimeUpdatePolicy> = {}): CustomRuntimeUpdatePolicy {
  return {
    managedRuntime: true,
    standardUpdateBlocked: true,
    sourceDurable: true,
    sourceDurabilityReason: "durable",
    backupConfigured: true,
    approvalPending: false,
    pendingCandidateSha: null,
    preparationRunning: false,
    preparationStatus: "idle",
    preparationReason: null,
    sourceSha: "a".repeat(40),
    sourceRepo: "/source.git",
    sourceBranch: `refs/provenance/${"a".repeat(40)}`,
    runtimeRoot: "/release",
    pointerPath: "/runtime-home/active-runtime.json",
    reason: "managed",
    ...overrides,
  };
}

describe("custom runtime update broker", () => {
  it("allows preparation but never turns a ready candidate into an implicit install", () => {
    expect(() => assertCustomRuntimeUpdateCanPrepare(policy())).not.toThrow();
    expect(() => assertCustomRuntimeUpdateCanPrepare(policy({ approvalPending: true }))).toThrow(
      CUSTOM_RUNTIME_UPDATE_EXACT_SHA_APPROVAL_REQUIRED_REASON,
    );
  });

  it("does not start duplicate preparation", () => {
    expect(() => assertCustomRuntimeUpdateCanPrepare(policy({ preparationRunning: true }))).toThrow(
      CUSTOM_RUNTIME_UPDATE_PREPARATION_RUNNING_REASON,
    );
  });

  it("fails closed when durable source proof is unavailable", () => {
    expect(() => assertCustomRuntimeUpdateCanPrepare(policy({ sourceDurable: false }))).toThrow(
      CUSTOM_RUNTIME_UPDATE_SAFETY_BLOCKED_REASON,
    );
  });

  it("fails closed when the encrypted recovery destination is unavailable", () => {
    expect(() => assertCustomRuntimeUpdateCanPrepare(policy({ backupConfigured: false }))).toThrow(
      CUSTOM_RUNTIME_UPDATE_SAFETY_BLOCKED_REASON,
    );
  });

  it("binds installation approval to the exact prepared candidate SHA", () => {
    const candidateSha = "b".repeat(40);
    const ready = policy({ approvalPending: true, pendingCandidateSha: candidateSha });

    expect(() => assertCustomRuntimeUpdateCanApprove(ready, candidateSha)).not.toThrow();
    expect(() => assertCustomRuntimeUpdateCanApprove(ready, "c".repeat(40))).toThrow(
      CUSTOM_RUNTIME_UPDATE_SAFETY_BLOCKED_REASON,
    );
    expect(() =>
      assertCustomRuntimeUpdateCanApprove(
        { ...ready, preparationStatus: "installing" },
        candidateSha,
      ),
    ).toThrow(CUSTOM_RUNTIME_UPDATE_SAFETY_BLOCKED_REASON);
    expect(() =>
      assertCustomRuntimeUpdateCanApprove({ ...ready, preparationRunning: true }, candidateSha),
    ).toThrow(CUSTOM_RUNTIME_UPDATE_SAFETY_BLOCKED_REASON);
    expect(() =>
      assertCustomRuntimeUpdateCanApprove(
        { ...ready, preparationStatus: "preparing" },
        candidateSha,
      ),
    ).toThrow(CUSTOM_RUNTIME_UPDATE_SAFETY_BLOCKED_REASON);
  });
});

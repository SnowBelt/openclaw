import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CUSTOM_RUNTIME_UPDATE_PREPARATION_RUNNING_REASON,
  CUSTOM_RUNTIME_UPDATE_EXACT_SHA_APPROVAL_REQUIRED_REASON,
  CUSTOM_RUNTIME_UPDATE_SAFETY_BLOCKED_REASON,
  assertCustomRuntimeUpdateCanApprove,
  assertCustomRuntimeUpdateCanPrepare,
  resolveCustomRuntimeUpdateBrokerEnv,
  startCustomRuntimeUpdateBroker,
} from "./custom-runtime-update-broker.js";
import type { CustomRuntimeUpdatePolicy } from "./custom-runtime-update-policy.js";

function policy(overrides: Partial<CustomRuntimeUpdatePolicy> = {}): CustomRuntimeUpdatePolicy {
  return {
    managedRuntime: true,
    standardUpdateBlocked: true,
    sourceDurable: true,
    sourceDurabilityReason: "durable",
    runtimeGuardHealthy: true,
    runtimeGuardReason: "healthy",
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

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

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

  it("fails closed when current runtime and route verification is unavailable", () => {
    expect(() =>
      assertCustomRuntimeUpdateCanPrepare(policy({ runtimeGuardHealthy: false })),
    ).toThrow(CUSTOM_RUNTIME_UPDATE_SAFETY_BLOCKED_REASON);
  });

  it("binds detached work to the runtime home selected by the policy pointer", () => {
    const pointerPath = "/custom/runtime-home/active-runtime.json";
    const env = resolveCustomRuntimeUpdateBrokerEnv({
      policy: policy({ pointerPath }),
      env: {
        HOME: "/Users/operator",
        OPENCLAW_CUSTOM_RUNTIME_HOME: "/wrong/runtime-home",
        OPENCLAW_CUSTOM_RUNTIME_RELEASES: "/custom/releases",
      },
    });

    expect(env).toMatchObject({
      OPENCLAW_CUSTOM_RUNTIME_HOME: "/custom/runtime-home",
      OPENCLAW_CUSTOM_RUNTIME_POINTER: pointerPath,
      OPENCLAW_CUSTOM_RUNTIME_RELEASES: "/custom/releases",
    });
  });

  it("verifies the current guard asynchronously and fails closed while another lifecycle owns it", async () => {
    const runtimeHome = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-update-broker-"));
    temporaryRoots.push(runtimeHome);
    const guard = path.join(runtimeHome, "bin", "custom-runtime-guard.sh");
    fs.mkdirSync(path.dirname(guard), { recursive: true });
    fs.writeFileSync(guard, "#!/bin/sh\nsleep 0.05\nexit 75\n", { mode: 0o700 });
    let eventLoopAdvanced = false;
    setTimeout(() => {
      eventLoopAdvanced = true;
    }, 0);

    await expect(
      startCustomRuntimeUpdateBroker({
        policy: policy({ pointerPath: path.join(runtimeHome, "active-runtime.json") }),
        homedir: runtimeHome,
      }),
    ).rejects.toThrow(CUSTOM_RUNTIME_UPDATE_SAFETY_BLOCKED_REASON);
    expect(eventLoopAdvanced).toBe(true);
  });

  it("rejects a non-executable runtime guard before detached work starts", async () => {
    const runtimeHome = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-update-broker-mode-"));
    temporaryRoots.push(runtimeHome);
    const guard = path.join(runtimeHome, "bin", "custom-runtime-guard.sh");
    fs.mkdirSync(path.dirname(guard), { recursive: true });
    fs.writeFileSync(guard, "#!/bin/sh\nexit 0\n", { mode: 0o600 });

    await expect(
      startCustomRuntimeUpdateBroker({
        policy: policy({ pointerPath: path.join(runtimeHome, "active-runtime.json") }),
        homedir: runtimeHome,
      }),
    ).rejects.toThrow(CUSTOM_RUNTIME_UPDATE_SAFETY_BLOCKED_REASON);
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

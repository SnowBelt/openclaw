// Launch the managed custom-runtime update broker without letting the running
// Gateway mutate its own immutable release.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CustomRuntimeUpdatePolicy } from "./custom-runtime-update-policy.js";

export const CUSTOM_RUNTIME_UPDATE_PREPARATION_STARTED_REASON =
  "custom-runtime-update-preparation-started";
export const CUSTOM_RUNTIME_UPDATE_APPROVAL_STARTED_REASON =
  "custom-runtime-update-approval-started";
export const CUSTOM_RUNTIME_UPDATE_EXACT_SHA_APPROVAL_REQUIRED_REASON =
  "custom-runtime-update-exact-sha-approval-required";
export const CUSTOM_RUNTIME_UPDATE_PREPARATION_RUNNING_REASON =
  "custom-runtime-update-preparation-running";
export const CUSTOM_RUNTIME_UPDATE_SAFETY_BLOCKED_REASON = "custom-runtime-update-safety-blocked";

export function assertCustomRuntimeUpdateCanPrepare(policy: CustomRuntimeUpdatePolicy): void {
  const backupCanBeRefreshed =
    policy.backupStatus === "ready" || policy.backupStatus === "stale";
  if (
    !policy.managedRuntime ||
    !policy.standardUpdateBlocked ||
    !policy.sourceDurable ||
    !policy.backupConfigured ||
    !backupCanBeRefreshed
  ) {
    throw new Error(CUSTOM_RUNTIME_UPDATE_SAFETY_BLOCKED_REASON);
  }
  if (policy.approvalPending) {
    throw new Error(CUSTOM_RUNTIME_UPDATE_EXACT_SHA_APPROVAL_REQUIRED_REASON);
  }
  if (policy.preparationRunning) {
    throw new Error(CUSTOM_RUNTIME_UPDATE_PREPARATION_RUNNING_REASON);
  }
}

export function assertCustomRuntimeUpdateCanApprove(
  policy: CustomRuntimeUpdatePolicy,
  approvalSha: string,
): void {
  if (
    !policy.managedRuntime ||
    !policy.standardUpdateBlocked ||
    !policy.sourceDurable ||
    !policy.backupConfigured ||
    policy.backupStatus !== "ready" ||
    !policy.approvalPending ||
    !policy.pendingCandidateSha ||
    policy.pendingCandidateSha !== approvalSha
  ) {
    throw new Error(CUSTOM_RUNTIME_UPDATE_SAFETY_BLOCKED_REASON);
  }
}

function requireRegularFile(filePath: string): void {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(CUSTOM_RUNTIME_UPDATE_SAFETY_BLOCKED_REASON);
  }
}

export function startCustomRuntimeUpdateBroker(params: {
  policy: CustomRuntimeUpdatePolicy;
  env?: NodeJS.ProcessEnv;
  homedir?: string;
}): { action: "prepare"; pid: number; reason: string } {
  assertCustomRuntimeUpdateCanPrepare(params.policy);
  const runtimeHome = path.dirname(path.resolve(params.policy.pointerPath));
  const script = path.join(runtimeHome, "bin", "custom-runtime-updater.sh");
  requireRegularFile(script);
  const logRoot = path.join(params.homedir ?? os.homedir(), "Library", "Logs", "openclaw");
  fs.mkdirSync(logRoot, { recursive: true });
  const output = fs.openSync(path.join(logRoot, "custom-runtime-update.log"), "a", 0o600);
  const error = fs.openSync(path.join(logRoot, "custom-runtime-update-error.log"), "a", 0o600);
  let child;
  try {
    child = spawn("/bin/sh", [script, "--prepare"], {
      detached: true,
      env: params.env ?? process.env,
      stdio: ["ignore", output, error],
    });
  } finally {
    fs.closeSync(output);
    fs.closeSync(error);
  }
  if (!child.pid) {
    throw new Error(CUSTOM_RUNTIME_UPDATE_SAFETY_BLOCKED_REASON);
  }
  child.unref();
  return {
    action: "prepare",
    pid: child.pid,
    reason: CUSTOM_RUNTIME_UPDATE_PREPARATION_STARTED_REASON,
  };
}

export function startCustomRuntimeUpdateApproval(params: {
  policy: CustomRuntimeUpdatePolicy;
  approvalSha: string;
  env?: NodeJS.ProcessEnv;
  homedir?: string;
}): { action: "install"; pid: number; reason: string } {
  assertCustomRuntimeUpdateCanApprove(params.policy, params.approvalSha);
  const runtimeHome = path.dirname(path.resolve(params.policy.pointerPath));
  const script = path.join(runtimeHome, "bin", "custom-runtime-update-approve.sh");
  requireRegularFile(script);
  const logRoot = path.join(params.homedir ?? os.homedir(), "Library", "Logs", "openclaw");
  fs.mkdirSync(logRoot, { recursive: true });
  const output = fs.openSync(path.join(logRoot, "custom-runtime-update-approval.log"), "a", 0o600);
  const error = fs.openSync(
    path.join(logRoot, "custom-runtime-update-approval-error.log"),
    "a",
    0o600,
  );
  let child;
  try {
    child = spawn(
      "/bin/sh",
      [
        script,
        "--receipt",
        path.join(runtimeHome, "pending-update.json"),
        "--sha",
        params.approvalSha,
      ],
      {
        detached: true,
        env: params.env ?? process.env,
        stdio: ["ignore", output, error],
      },
    );
  } finally {
    fs.closeSync(output);
    fs.closeSync(error);
  }
  if (!child.pid) {
    throw new Error(CUSTOM_RUNTIME_UPDATE_SAFETY_BLOCKED_REASON);
  }
  child.unref();
  return {
    action: "install",
    pid: child.pid,
    reason: CUSTOM_RUNTIME_UPDATE_APPROVAL_STARTED_REASON,
  };
}

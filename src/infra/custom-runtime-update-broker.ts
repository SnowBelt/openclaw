// Launch the managed custom-runtime update broker without letting the running
// Gateway mutate its own immutable release.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  acquireCustomRuntimeSurfaceLease,
  type CustomRuntimeSurfaceLease,
} from "./custom-runtime-surface-lease.js";
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
  if (
    !policy.managedRuntime ||
    !policy.standardUpdateBlocked ||
    !policy.sourceDurable ||
    !policy.runtimeGuardHealthy ||
    !policy.backupConfigured
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
    !policy.runtimeGuardHealthy ||
    !policy.backupConfigured ||
    !policy.approvalPending ||
    !policy.pendingCandidateSha ||
    policy.pendingCandidateSha !== approvalSha ||
    policy.preparationRunning ||
    policy.preparationStatus === "preparing" ||
    policy.preparationStatus === "installing"
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

async function assertCurrentRuntimeGuard(params: {
  policy: CustomRuntimeUpdatePolicy;
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  const runtimeHome = path.dirname(path.resolve(params.policy.pointerPath));
  const guard = path.join(runtimeHome, "bin", "custom-runtime-guard.sh");
  requireRegularFile(guard);
  try {
    fs.accessSync(guard, fs.constants.X_OK);
  } catch {
    throw new Error(CUSTOM_RUNTIME_UPDATE_SAFETY_BLOCKED_REASON);
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(guard, ["--verify-only"], {
      env: resolveCustomRuntimeUpdateBrokerEnv(params),
      stdio: "ignore",
    });
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(CUSTOM_RUNTIME_UPDATE_SAFETY_BLOCKED_REASON));
    }, 30_000);
    child.once("error", () => {
      clearTimeout(timeout);
      reject(new Error(CUSTOM_RUNTIME_UPDATE_SAFETY_BLOCKED_REASON));
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(CUSTOM_RUNTIME_UPDATE_SAFETY_BLOCKED_REASON));
      }
    });
  });
}

export function resolveCustomRuntimeUpdateBrokerEnv(params: {
  policy: CustomRuntimeUpdatePolicy;
  env?: NodeJS.ProcessEnv;
}): NodeJS.ProcessEnv {
  const pointerPath = path.resolve(params.policy.pointerPath);
  return {
    ...(params.env ?? process.env),
    OPENCLAW_CUSTOM_RUNTIME_HOME: path.dirname(pointerPath),
    OPENCLAW_CUSTOM_RUNTIME_POINTER: pointerPath,
  };
}

export async function startCustomRuntimeUpdateBroker(params: {
  policy: CustomRuntimeUpdatePolicy;
  env?: NodeJS.ProcessEnv;
  homedir?: string;
}): Promise<{ action: "prepare"; pid: number; reason: string }> {
  assertCustomRuntimeUpdateCanPrepare(params.policy);
  await assertCurrentRuntimeGuard(params);
  const runtimeHome = path.dirname(path.resolve(params.policy.pointerPath));
  const script = path.join(runtimeHome, "bin", "custom-runtime-updater.sh");
  requireRegularFile(script);
  const logRoot = path.join(params.homedir ?? os.homedir(), "Library", "Logs", "openclaw");
  fs.mkdirSync(logRoot, { recursive: true });
  const output = fs.openSync(path.join(logRoot, "custom-runtime-update.log"), "a", 0o600);
  const error = fs.openSync(path.join(logRoot, "custom-runtime-update-error.log"), "a", 0o600);
  let lease: CustomRuntimeSurfaceLease | undefined;
  let child: ReturnType<typeof spawn>;
  try {
    lease = acquireCustomRuntimeSurfaceLease({
      env: params.env ?? process.env,
      key: "candidate-preparation",
      owner: `gateway-update-broker:${process.pid}`,
      activeSha: params.policy.sourceSha,
      operation: "prepare-verified-update",
    });
    child = spawn("/bin/sh", [script, "--prepare"], {
      detached: true,
      env: resolveCustomRuntimeUpdateBrokerEnv(params),
      stdio: ["ignore", output, error],
    });
    attachSurfaceLeaseLifecycle(child, lease);
  } catch (caughtError) {
    lease?.release();
    throw caughtError;
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

export async function startCustomRuntimeUpdateApproval(params: {
  policy: CustomRuntimeUpdatePolicy;
  approvalSha: string;
  env?: NodeJS.ProcessEnv;
  homedir?: string;
}): Promise<{ action: "install"; pid: number; reason: string }> {
  assertCustomRuntimeUpdateCanApprove(params.policy, params.approvalSha);
  await assertCurrentRuntimeGuard(params);
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
  let lease: CustomRuntimeSurfaceLease | undefined;
  let child: ReturnType<typeof spawn>;
  try {
    lease = acquireCustomRuntimeSurfaceLease({
      env: params.env ?? process.env,
      key: "gateway-runtime",
      owner: `gateway-update-approval:${process.pid}`,
      activeSha: params.policy.sourceSha,
      candidateSha: params.approvalSha,
      operation: "install-verified-update",
    });
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
        env: resolveCustomRuntimeUpdateBrokerEnv(params),
        stdio: ["ignore", output, error],
      },
    );
    attachSurfaceLeaseLifecycle(child, lease);
  } catch (caughtError) {
    lease?.release();
    throw caughtError;
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

function attachSurfaceLeaseLifecycle(
  child: ReturnType<typeof spawn>,
  lease: CustomRuntimeSurfaceLease,
): void {
  let released = false;
  const release = () => {
    if (released) {
      return;
    }
    released = true;
    try {
      lease.release();
    } catch {
      // The child is already terminal; do not turn a cleanup failure into an uncaught event.
    }
  };
  const heartbeatTimer = setInterval(() => {
    try {
      lease.heartbeat();
    } catch {
      clearInterval(heartbeatTimer);
      child.kill("SIGTERM");
      release();
    }
  }, 60_000);
  child.once("exit", () => {
    clearInterval(heartbeatTimer);
    release();
  });
  child.once("error", () => {
    clearInterval(heartbeatTimer);
    release();
  });
}

// Read-only update safety status for the Project Command Center.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  resolveCustomRuntimeUpdatePolicy,
  type CustomRuntimeUpdatePolicyOptions,
} from "../infra/custom-runtime-update-policy.js";

export type PccUpdateSafetyReceipt = {
  at: string | null;
  result: string;
  stage: string | null;
};

export type PccUpdateSafety = {
  status: "protected" | "attention" | "unmanaged";
  standardUpdateBlocked: boolean;
  sourceDurable: boolean;
  backupConfigured: boolean;
  brokerConfigured: boolean;
  runtimeGuardConfigured: boolean;
  approvalPending: boolean;
  pendingCandidateSha: string | null;
  preparationRunning: boolean;
  preparationStatus: "blocked" | "idle" | "preparing" | "ready" | "installing" | "failed";
  preparationReason: string | null;
  sourceSha: string | null;
  sourceBranch: string | null;
  activeRelease: string | null;
  lastReceipt: PccUpdateSafetyReceipt | null;
  issues: string[];
};

export type PccUpdateSafetyOptions = CustomRuntimeUpdatePolicyOptions & {
  runtimeHome?: string;
  launchAgentPath?: string;
  schedulerLoaded?: boolean;
  guardLaunchAgentPath?: string;
  guardLoaded?: boolean;
};

const UPDATE_SCHEDULER_LABEL = "ai.openclaw.custom-runtime.update-weekly";
const RUNTIME_GUARD_LABEL = "ai.openclaw.custom-runtime.guard";

function readJson(filePath: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function receiptTimestamp(value: string | null, filePath: string): number {
  if (value) {
    const compact = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/u.exec(value);
    const parsed = Date.parse(
      compact
        ? `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}Z`
        : value,
    );
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function latestReceipt(receiptsDir: string): PccUpdateSafetyReceipt | null {
  let names: string[];
  try {
    names = fs
      .readdirSync(receiptsDir)
      .filter((name) => name.startsWith("update-") && name.endsWith(".json"));
  } catch {
    return null;
  }
  const receipts: Array<PccUpdateSafetyReceipt & { name: string; timestamp: number }> = [];
  for (const name of names) {
    const filePath = path.join(receiptsDir, name);
    const value = readJson(filePath);
    const result = text(value?.result);
    if (result) {
      const at = text(value?.at);
      receipts.push({
        at,
        result,
        stage: text(value?.stage),
        name,
        timestamp: receiptTimestamp(at, filePath),
      });
    }
  }
  const latest = receipts.toSorted(
    (left, right) => right.timestamp - left.timestamp || right.name.localeCompare(left.name),
  )[0];
  return latest ? { at: latest.at, result: latest.result, stage: latest.stage } : null;
}

function isLaunchAgentLoaded(label: string): boolean {
  if (process.platform !== "darwin" || typeof process.getuid !== "function") {
    return false;
  }
  const result = spawnSync("/bin/launchctl", ["print", `gui/${process.getuid()}/${label}`], {
    stdio: "ignore",
    timeout: 1_000,
  });
  return result.status === 0;
}

function isRegularFile(filePath: string): boolean {
  try {
    const stat = fs.lstatSync(filePath);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

export async function readPccUpdateSafety(
  options: PccUpdateSafetyOptions = {},
): Promise<PccUpdateSafety> {
  const homedir = options.homedir ?? os.homedir();
  const runtimeHome = options.runtimeHome ?? path.join(homedir, ".openclaw-custom-runtime");
  const guardLaunchAgentPath =
    options.guardLaunchAgentPath ??
    options.runtimeGuardLaunchAgentPath ??
    text(options.env?.OPENCLAW_CUSTOM_RUNTIME_GUARD_PLIST) ??
    path.join(homedir, "Library", "LaunchAgents", "ai.openclaw.custom-runtime.guard.plist");
  const guardLabel =
    options.runtimeGuardLabel ??
    text(options.env?.OPENCLAW_CUSTOM_RUNTIME_GUARD_LABEL) ??
    RUNTIME_GUARD_LABEL;
  const guardLoaded = options.guardLoaded ?? isLaunchAgentLoaded(guardLabel);
  const policy = await resolveCustomRuntimeUpdatePolicy({
    ...(options.env ? { env: options.env } : {}),
    homedir,
    ...(options.argv ? { argv: options.argv } : {}),
    ...(options.pointerPath ? { pointerPath: options.pointerPath } : {}),
    runtimeGuardLaunchAgentPath: guardLaunchAgentPath,
    runtimeGuardLabel: guardLabel,
    runtimeGuardLoaded: guardLoaded,
  });
  const pointer = readJson(policy.pointerPath);
  const launchAgentPath =
    options.launchAgentPath ??
    path.join(homedir, "Library", "LaunchAgents", "ai.openclaw.custom-runtime.update-weekly.plist");
  const brokerInstalled =
    fs.existsSync(path.join(runtimeHome, "bin", "custom-runtime-updater.sh")) &&
    fs.existsSync(path.join(runtimeHome, "bin", "custom-runtime-update-approve.sh")) &&
    fs.existsSync(path.join(runtimeHome, "bin", "custom-runtime-update-backup.mjs")) &&
    fs.existsSync(path.join(runtimeHome, "bin", "custom-runtime-update-github-proof.mjs")) &&
    fs.existsSync(launchAgentPath);
  const schedulerLoaded = options.schedulerLoaded ?? isLaunchAgentLoaded(UPDATE_SCHEDULER_LABEL);
  const brokerConfigured = brokerInstalled && schedulerLoaded;
  const runtimeGuardInstalled =
    isRegularFile(path.join(runtimeHome, "bin", "custom-runtime-guard.sh")) &&
    isRegularFile(guardLaunchAgentPath);
  const runtimeGuardConfigured = runtimeGuardInstalled && guardLoaded;
  const backupConfigured = policy.backupConfigured;
  const issues: string[] = [];
  if (policy.managedRuntime && !policy.standardUpdateBlocked) {
    issues.push("Generic update paths are not blocked for the active custom runtime.");
  }
  if (policy.managedRuntime && !policy.sourceDurable) {
    issues.push(policy.sourceDurabilityReason);
  }
  const runtimeGuardAgentIssue = policy.runtimeGuardReason.startsWith(
    "The recovery guard LaunchAgent",
  );
  if (policy.managedRuntime && !policy.runtimeGuardHealthy && !runtimeGuardAgentIssue) {
    issues.push(policy.runtimeGuardReason);
  }
  if (policy.managedRuntime && !backupConfigured) {
    issues.push("The encrypted external update-backup destination is unavailable.");
  }
  if (policy.managedRuntime && !brokerInstalled) {
    issues.push("The verified custom-runtime update broker is not fully installed.");
  } else if (policy.managedRuntime && !schedulerLoaded) {
    issues.push("The verified custom-runtime update broker is installed but not scheduled.");
  }
  if (policy.managedRuntime && !runtimeGuardInstalled) {
    issues.push("The verified custom-runtime recovery guard is not fully installed.");
  } else if (policy.managedRuntime && !guardLoaded) {
    issues.push("The verified custom-runtime recovery guard is installed but not scheduled.");
  }
  if (policy.managedRuntime && policy.preparationStatus === "failed") {
    issues.push(
      `Verified update preparation failed: ${policy.preparationReason ?? "unknown failure"}.`,
    );
  }
  const status = !policy.managedRuntime
    ? "unmanaged"
    : issues.length === 0
      ? "protected"
      : "attention";
  return {
    status,
    standardUpdateBlocked: policy.standardUpdateBlocked,
    sourceDurable: policy.sourceDurable,
    backupConfigured,
    brokerConfigured,
    runtimeGuardConfigured,
    approvalPending: policy.approvalPending,
    pendingCandidateSha: policy.pendingCandidateSha,
    preparationRunning: policy.preparationRunning,
    preparationStatus: policy.preparationStatus,
    preparationReason: policy.preparationReason,
    sourceSha: policy.sourceSha,
    sourceBranch: policy.sourceBranch,
    activeRelease: text(pointer?.releaseId),
    lastReceipt: latestReceipt(path.join(runtimeHome, "receipts")),
    issues,
  };
}

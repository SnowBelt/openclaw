// Read-only update safety status for the Project Command Center.
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
  brokerConfigured: boolean;
  approvalPending: boolean;
  sourceSha: string | null;
  sourceBranch: string | null;
  activeRelease: string | null;
  lastReceipt: PccUpdateSafetyReceipt | null;
  issues: string[];
};

export type PccUpdateSafetyOptions = CustomRuntimeUpdatePolicyOptions & {
  runtimeHome?: string;
  launchAgentPath?: string;
};

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

function latestReceipt(receiptsDir: string): PccUpdateSafetyReceipt | null {
  let names: string[];
  try {
    names = fs
      .readdirSync(receiptsDir)
      .filter((name) => name.startsWith("update-") && name.endsWith(".json"))
      .toSorted()
      .toReversed();
  } catch {
    return null;
  }
  for (const name of names) {
    const value = readJson(path.join(receiptsDir, name));
    const result = text(value?.result);
    if (result) {
      return { at: text(value?.at), result, stage: text(value?.stage) };
    }
  }
  return null;
}

export function readPccUpdateSafety(options: PccUpdateSafetyOptions = {}): PccUpdateSafety {
  const homedir = options.homedir ?? os.homedir();
  const runtimeHome = options.runtimeHome ?? path.join(homedir, ".openclaw-custom-runtime");
  const policy = resolveCustomRuntimeUpdatePolicy({
    ...(options.env ? { env: options.env } : {}),
    homedir,
    ...(options.argv ? { argv: options.argv } : {}),
    ...(options.pointerPath ? { pointerPath: options.pointerPath } : {}),
  });
  const pointer = readJson(policy.pointerPath);
  const brokerConfigured =
    fs.existsSync(path.join(runtimeHome, "bin", "custom-runtime-updater.sh")) &&
    fs.existsSync(path.join(runtimeHome, "bin", "custom-runtime-update-approve.sh")) &&
    fs.existsSync(
      options.launchAgentPath ??
        path.join(
          homedir,
          "Library",
          "LaunchAgents",
          "ai.openclaw.custom-runtime.update-weekly.plist",
        ),
    );
  const pending = readJson(path.join(runtimeHome, "pending-update.json"));
  const approvalPending = pending?.result === "ready_for_approval";
  const issues: string[] = [];
  if (policy.managedRuntime && !policy.standardUpdateBlocked) {
    issues.push("Generic update paths are not blocked for the active custom runtime.");
  }
  if (policy.managedRuntime && !policy.sourceDurable) {
    issues.push(
      "The active runtime is not bound to a durable Git commit, source repo, and branch.",
    );
  }
  if (policy.managedRuntime && !brokerConfigured) {
    issues.push("The verified custom-runtime update broker is not fully installed.");
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
    brokerConfigured,
    approvalPending,
    sourceSha: policy.sourceSha,
    sourceBranch: policy.sourceBranch,
    activeRelease: text(pointer?.releaseId),
    lastReceipt: latestReceipt(path.join(runtimeHome, "receipts")),
    issues,
  };
}

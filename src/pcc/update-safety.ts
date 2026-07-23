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

function isOperatorOwned(stat: fs.Stats): boolean {
  const uid = process.getuid?.();
  return (uid === undefined || stat.uid === uid) && (stat.mode & 0o022) === 0;
}

function isExecutableFile(filePath: string): boolean {
  try {
    const stat = fs.lstatSync(filePath);
    return (
      stat.isFile() &&
      !stat.isSymbolicLink() &&
      isOperatorOwned(stat) &&
      (fs.accessSync(filePath, fs.constants.X_OK), true)
    );
  } catch {
    return false;
  }
}

function xmlText(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function plistString(xml: string, key: string): string | null {
  const match = new RegExp(`<key>\\s*${key}\\s*</key>\\s*<string>([^<]*)</string>`, "u").exec(xml);
  return match ? xmlText(match[1].trim()) : null;
}

function plistInteger(xml: string, key: string): number | null {
  const match = new RegExp(`<key>\\s*${key}\\s*</key>\\s*<integer>(\\d+)</integer>`, "u").exec(xml);
  return match ? Number(match[1]) : null;
}

function isValidBrokerPlist(filePath: string, homedir: string, runtimeHome: string): boolean {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0 || !isOperatorOwned(stat)) {
      return false;
    }
    const xml = fs.readFileSync(filePath, "utf8");
    const programArray = /<key>\s*ProgramArguments\s*<\/key>\s*<array>([\s\S]*?)<\/array>/u.exec(
      xml,
    )?.[1];
    const schedule = /<key>\s*StartCalendarInterval\s*<\/key>\s*<dict>([\s\S]*?)<\/dict>/u.exec(
      xml,
    )?.[1];
    if (!programArray || !schedule) {
      return false;
    }
    const argumentsList = [...programArray.matchAll(/<string>([^<]*)<\/string>/gu)].map((match) =>
      xmlText(match[1].trim()),
    );
    return (
      plistString(xml, "Label") === "ai.openclaw.custom-runtime.update-weekly" &&
      argumentsList.length === 1 &&
      argumentsList[0] === path.join(runtimeHome, "bin", "custom-runtime-updater.sh") &&
      /<key>\s*RunAtLoad\s*<\/key>\s*<false\s*\/>/u.test(xml) &&
      plistInteger(schedule, "Weekday") === 0 &&
      plistInteger(schedule, "Hour") === 3 &&
      plistInteger(schedule, "Minute") === 30 &&
      plistString(xml, "StandardOutPath") ===
        path.join(homedir, "Library", "Logs", "openclaw", "custom-runtime-update.log") &&
      plistString(xml, "StandardErrorPath") ===
        path.join(homedir, "Library", "Logs", "openclaw", "custom-runtime-update-error.log")
    );
  } catch {
    return false;
  }
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
    ...(options.durableSourceRoot ? { durableSourceRoot: options.durableSourceRoot } : {}),
  });
  const pointer = readJson(policy.pointerPath);
  const brokerConfigured =
    isExecutableFile(path.join(runtimeHome, "bin", "custom-runtime-updater.sh")) &&
    isExecutableFile(path.join(runtimeHome, "bin", "custom-runtime-update-approve.sh")) &&
    isValidBrokerPlist(
      options.launchAgentPath ??
        path.join(
          homedir,
          "Library",
          "LaunchAgents",
          "ai.openclaw.custom-runtime.update-weekly.plist",
        ),
      homedir,
      runtimeHome,
    );
  const pending = readJson(path.join(runtimeHome, "pending-update.json"));
  const approvalPending = pending?.result === "ready_for_approval";
  const issues: string[] = [];
  if (policy.managedRuntime && !policy.standardUpdateBlocked) {
    issues.push("Generic update paths are not blocked for the active custom runtime.");
  }
  if (policy.managedRuntime && !policy.sourceDurable) {
    issues.push(
      "The active runtime is not bound to a durable Git commit, persistent source and object store, branch, and exact remote recovery ref.",
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

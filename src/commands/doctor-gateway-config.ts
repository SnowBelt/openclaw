/** Narrow Gateway config doctor checks and safe repairs. */
import fs from "node:fs/promises";
import path from "node:path";
import JSON5 from "json5";
import { replaceConfigFile } from "../config/mutate.js";
import { resolveConfigPathCandidate } from "../config/paths.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { validateConfigObjectRawWithPlugins } from "../config/validation.js";

type JsonObject = Record<string, unknown>;

export type GatewayConfigDoctorMode = "check" | "fix";

export type GatewayConfigDoctorReport = {
  ok: boolean;
  mode: GatewayConfigDoctorMode;
  configPath: string;
  exists: boolean;
  valid: boolean;
  repaired: boolean;
  changedPaths: string[];
  backupPath: string | null;
  issues: string[];
};

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatIssue(pathLabel: string, message: string): string {
  return `${pathLabel}: ${message}`;
}

function stripGatewayTailscaleRequired(parsed: unknown): {
  config: OpenClawConfig | null;
  changedPaths: string[];
} {
  if (!isRecord(parsed)) {
    return { config: null, changedPaths: [] };
  }
  const gateway = parsed.gateway;
  if (!isRecord(gateway)) {
    return { config: parsed as OpenClawConfig, changedPaths: [] };
  }
  const tailscale = gateway.tailscale;
  if (!isRecord(tailscale) || !Object.hasOwn(tailscale, "required")) {
    return { config: parsed as OpenClawConfig, changedPaths: [] };
  }
  const nextTailscale = { ...tailscale };
  delete nextTailscale.required;
  return {
    config: {
      ...parsed,
      gateway: {
        ...gateway,
        tailscale: nextTailscale,
      },
    } as OpenClawConfig,
    changedPaths: ["gateway.tailscale.required"],
  };
}

function validateCoreConfig(raw: unknown): { valid: boolean; issues: string[] } {
  const validation = validateConfigObjectRawWithPlugins(raw, { pluginValidation: "skip" });
  if (validation.ok) {
    return { valid: true, issues: [] };
  }
  return {
    valid: false,
    issues: validation.issues.map((issue) => formatIssue(issue.path || "<root>", issue.message)),
  };
}

function createBackupPath(configPath: string): string {
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  return path.join(
    path.dirname(configPath),
    `${path.basename(configPath)}.gateway-config-doctor.${stamp}.bak`,
  );
}

export async function runGatewayConfigDoctor(params: {
  mode: GatewayConfigDoctorMode;
  env?: NodeJS.ProcessEnv;
}): Promise<GatewayConfigDoctorReport> {
  const env = params.env ?? process.env;
  const configPath = resolveConfigPathCandidate(env);
  let raw: string | null = null;
  try {
    raw = await fs.readFile(configPath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  if (raw === null) {
    return {
      ok: true,
      mode: params.mode,
      configPath,
      exists: false,
      valid: true,
      repaired: false,
      changedPaths: [],
      backupPath: null,
      issues: [],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON5.parse(raw);
  } catch (error) {
    return {
      ok: false,
      mode: params.mode,
      configPath,
      exists: true,
      valid: false,
      repaired: false,
      changedPaths: [],
      backupPath: null,
      issues: [formatIssue("<parse>", error instanceof Error ? error.message : String(error))],
    };
  }

  const initial = validateCoreConfig(parsed);
  const repaired = stripGatewayTailscaleRequired(parsed);
  if (repaired.config === null) {
    return {
      ok: false,
      mode: params.mode,
      configPath,
      exists: true,
      valid: false,
      repaired: false,
      changedPaths: [],
      backupPath: null,
      issues: [formatIssue("<root>", "config root must be an object")],
    };
  }

  const repairedValidation = validateCoreConfig(repaired.config);
  if (params.mode === "check" || repaired.changedPaths.length === 0) {
    return {
      ok: initial.valid,
      mode: params.mode,
      configPath,
      exists: true,
      valid: initial.valid,
      repaired: false,
      changedPaths: repaired.changedPaths,
      backupPath: null,
      issues: initial.valid ? [] : initial.issues,
    };
  }

  if (!repairedValidation.valid) {
    return {
      ok: false,
      mode: params.mode,
      configPath,
      exists: true,
      valid: false,
      repaired: false,
      changedPaths: repaired.changedPaths,
      backupPath: null,
      issues: repairedValidation.issues,
    };
  }

  const backupPath = createBackupPath(configPath);
  await fs.mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
  await fs.copyFile(configPath, backupPath);
  await replaceConfigFile({
    nextConfig: repaired.config,
    afterWrite: {
      mode: "none",
      reason: "gateway config doctor reports the repair before runtime reload",
    },
    writeOptions: {
      envSnapshotForRestore: env,
      expectedConfigPath: configPath,
      ownedConfigPathForWrite: configPath,
      skipPluginValidation: true,
      skipRuntimeSnapshotRefresh: true,
      skipOutputLogs: true,
      allowConfigSizeDrop: true,
    },
  });

  return {
    ok: true,
    mode: params.mode,
    configPath,
    exists: true,
    valid: true,
    repaired: true,
    changedPaths: repaired.changedPaths,
    backupPath,
    issues: [],
  };
}

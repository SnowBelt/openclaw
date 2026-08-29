import fs from "node:fs/promises";
import path from "node:path";
import {
  assertAssetFilesPrivateFromMutation,
  readAssetDigests,
  WORKER_SCRIPT_PATH,
} from "./assets.js";
import { sha256Bytes, sha256File, stableStringify } from "./crypto.js";
import { runCommand, SAFE_EXEC_PATH } from "./process.js";
import type { ResolvedRingerConfig, RingerPinStatus } from "./types.js";

async function privateRegularFile(file: string, label: string): Promise<string[]> {
  const errors: string[] = [];
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      errors.push(`${label} is not a regular non-symlink file.`);
    }
    if ((stat.mode & 0o077) !== 0) {
      errors.push(`${label} must have 0600 permissions.`);
    }
  } catch (error) {
    errors.push(
      `${label} is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return errors;
}

function sectionBody(source: string, sectionName: string): string | undefined {
  const lines = source.split(/\r?\n/u);
  const header = `[${sectionName}]`;
  const start = lines.findIndex((line) => line.trim() === header);
  if (start < 0) {
    return undefined;
  }
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*\[/u.test(line)) {
      break;
    }
    body.push(line.replace(/\s+#.*$/u, ""));
  }
  return body.join("\n");
}

async function inspectRingerConfig(config: ResolvedRingerConfig): Promise<string[]> {
  const configPath = config.ringerConfigPath!;
  const errors = await privateRegularFile(configPath, "Ringer config");
  let source: string;
  try {
    source = await fs.readFile(configPath, "utf8");
  } catch {
    return errors;
  }
  if (source !== renderPinnedRingerConfig({ stateDir: config.stateDir })) {
    errors.push(
      "Ringer config does not byte-match the adapter-generated canonical config for this stateDir.",
    );
  }
  const rootBeforeFirstTable = source.split(/^\s*\[/mu)[0] ?? "";
  if (!/^\s*allow_full_access\s*=\s*false\s*(?:#.*)?$/mu.test(rootBeforeFirstTable)) {
    errors.push("Ringer config must set root allow_full_access=false.");
  }
  const update = sectionBody(source, "update");
  if (!update || !/^\s*auto\s*=\s*false\s*$/mu.test(update)) {
    errors.push("Ringer config must set [update] auto=false.");
  }
  const engine = sectionBody(source, "engines.openclaw-local");
  if (!engine) {
    errors.push("Ringer config is missing [engines.openclaw-local].");
    return errors;
  }
  const requiredFragments = [
    JSON.stringify(process.execPath),
    JSON.stringify(WORKER_SCRIPT_PATH),
    JSON.stringify("{taskdir}"),
    JSON.stringify("{model}"),
    JSON.stringify("{spec}"),
    JSON.stringify("{engine_args}"),
  ];
  for (const fragment of requiredFragments) {
    if (!engine.includes(fragment)) {
      errors.push(`openclaw-local engine is missing exact fragment ${fragment}.`);
    }
  }
  if (!/^\s*sandbox_args\s*=\s*\[\s*\]\s*$/mu.test(engine)) {
    errors.push("openclaw-local sandbox_args must be empty; OpenClaw owns the Docker sandbox.");
  }
  if (!/^\s*full_access_args\s*=\s*\[\s*\]\s*$/mu.test(engine)) {
    errors.push("openclaw-local full_access_args must be empty.");
  }
  if (engine.includes("{access_args}") || engine.includes("{model_args}")) {
    errors.push("openclaw-local args_template cannot use access_args or model_args.");
  }
  return errors;
}

export async function verifyPins(config: ResolvedRingerConfig): Promise<RingerPinStatus> {
  const errors: string[] = [];
  let assets = { workerSha256: "", verifierSha256: "" };
  try {
    await assertAssetFilesPrivateFromMutation();
    assets = await readAssetDigests();
  } catch (error) {
    errors.push(
      `Trusted adapter asset verification failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const actual: RingerPinStatus["actual"] = {
    workerSha256: assets.workerSha256,
    verifierSha256: assets.verifierSha256,
    policySha256: computePolicyDigest(config),
  };
  if (actual.policySha256 !== config.expectedPolicySha256) {
    errors.push(
      `Plugin policy digest mismatch: expected ${config.expectedPolicySha256}, found ${actual.policySha256}.`,
    );
  }
  if (!config.ringerSourceDir || !config.ringerConfigPath || !config.openclawCliPath) {
    return { ok: false, errors: ["Enabled Ringer paths are incomplete."], actual };
  }
  const sourceDir = path.resolve(config.ringerSourceDir);
  const scriptPath = path.join(sourceDir, "ringer.py");
  try {
    const result = await runCommand("git", ["-C", sourceDir, "rev-parse", "HEAD"], {
      timeoutMs: 10_000,
      env: { PATH: SAFE_EXEC_PATH, GIT_CONFIG_NOSYSTEM: "1" },
    });
    actual.ringerCommit = result.stdout.toString("utf8").trim();
    if (result.code !== 0 || actual.ringerCommit !== config.expectedRingerCommit) {
      errors.push(
        `Ringer commit mismatch: expected ${config.expectedRingerCommit}, found ${actual.ringerCommit ?? "unavailable"}.`,
      );
    }
    actual.ringerSha256 = await sha256File(scriptPath);
    if (actual.ringerSha256 !== config.expectedRingerSha256) {
      errors.push(
        `ringer.py digest mismatch: expected ${config.expectedRingerSha256}, found ${actual.ringerSha256}.`,
      );
    }
  } catch (error) {
    errors.push(
      `Ringer source verification failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    const image = await runCommand(
      "docker",
      ["image", "inspect", "--format", "{{.Id}}", config.dockerImage],
      {
        timeoutMs: 10_000,
        env: {
          PATH: SAFE_EXEC_PATH,
          LANG: "C.UTF-8",
          ...(config.dockerHost ? { DOCKER_HOST: config.dockerHost } : {}),
        },
      },
    );
    actual.dockerImageSha256 = image.stdout.toString("utf8").trim();
    if (image.code !== 0 || actual.dockerImageSha256 !== config.expectedDockerImageSha256) {
      errors.push(
        `Docker sandbox image digest mismatch: expected ${config.expectedDockerImageSha256}, found ${actual.dockerImageSha256 || "unavailable"}.`,
      );
    }
  } catch (error) {
    errors.push(
      `Docker sandbox image verification failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    actual.configSha256 = await sha256File(config.ringerConfigPath);
    if (actual.configSha256 !== config.expectedRingerConfigSha256) {
      errors.push(
        `Ringer config digest mismatch: expected ${config.expectedRingerConfigSha256}, found ${actual.configSha256}.`,
      );
    }
  } catch (error) {
    errors.push(
      `Ringer config digest failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  errors.push(...(await inspectRingerConfig(config)));
  try {
    const cliRealPath = await fs.realpath(config.openclawCliPath);
    actual.openclawCliSha256 = await sha256File(cliRealPath);
    if (actual.openclawCliSha256 !== config.expectedOpenclawCliSha256) {
      errors.push(
        `OpenClaw CLI digest mismatch: expected ${config.expectedOpenclawCliSha256}, found ${actual.openclawCliSha256}.`,
      );
    }
    const version = await runCommand(config.openclawCliPath, ["--version"], {
      timeoutMs: 10_000,
      env: { PATH: SAFE_EXEC_PATH, LANG: "C.UTF-8" },
    });
    actual.openclawVersion = version.stdout.toString("utf8").trim();
    if (version.code !== 0 || actual.openclawVersion !== config.expectedOpenclawVersion) {
      errors.push(
        `OpenClaw CLI version mismatch: expected ${config.expectedOpenclawVersion}, found ${actual.openclawVersion || "unavailable"}.`,
      );
    }
  } catch (error) {
    errors.push(
      `OpenClaw CLI verification failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (assets.workerSha256 !== config.expectedWorkerSha256) {
    errors.push(
      `Local worker digest mismatch: expected ${config.expectedWorkerSha256}, found ${assets.workerSha256}.`,
    );
  }
  if (assets.verifierSha256 !== config.expectedVerifierSha256) {
    errors.push(
      `Verifier wrapper digest mismatch: expected ${config.expectedVerifierSha256}, found ${assets.verifierSha256}.`,
    );
  }
  return { ok: errors.length === 0, errors, actual };
}

export function computePolicyDigest(config: ResolvedRingerConfig): string {
  const { expectedPolicySha256: _expectedPolicySha256, ...policy } = config;
  return sha256Bytes(stableStringify(policy));
}

export function computeEnvironmentDigest(actual: RingerPinStatus["actual"]): string {
  return sha256Bytes(stableStringify(actual));
}

export function renderPinnedRingerConfig(params: { stateDir: string }): string {
  return [
    `state_dir = ${JSON.stringify(path.join(path.resolve(params.stateDir), "upstream"))}`,
    "allow_full_access = false",
    "",
    "[update]",
    "auto = false",
    "",
    "[eval]",
    'backend = "jsonl"',
    `jsonl_path = ${JSON.stringify(path.join(path.resolve(params.stateDir), "upstream", "runs.jsonl"))}`,
    "",
    "[engines.openclaw-local]",
    `bin = ${JSON.stringify(process.execPath)}`,
    "args_template = [",
    `  ${JSON.stringify(WORKER_SCRIPT_PATH)},`,
    '  "--taskdir", "{taskdir}",',
    '  "--model", "{model}",',
    '  "--spec", "{spec}",',
    '  "{engine_args}",',
    "]",
    "sandbox_args = []",
    "full_access_args = []",
    'model_report_regex = "(?m)^model:[ \\t]*([^ \\t\\r\\n]+)[ \\t]*\\r?$"',
    "",
  ].join("\n");
}

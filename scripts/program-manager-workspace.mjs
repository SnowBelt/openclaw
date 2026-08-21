#!/usr/bin/env node

import fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_SOURCE_ROOT = path.resolve(SCRIPT_DIR, "..", "control", "program-manager");

export const MANAGED_FILES = Object.freeze([
  "workspace/AGENTS.md",
  "workspace/TOOLS.md",
  "workspace/SOUL.md",
  "workspace/IDENTITY.md",
  "workspace/USER.md",
  "workspace/HEARTBEAT.md",
  "state/program-manager.json",
]);

const BOOTSTRAP_FILES = Object.freeze(
  MANAGED_FILES.filter((entry) => entry.startsWith("workspace/")),
);
const ALLOWED_TOOLS = Object.freeze([
  "get_goal",
  "read",
  "sessions_spawn",
  "sessions_yield",
  "update_plan",
]);
const REQUIRED_DENIED_TOOLS = Object.freeze([
  "apply_patch",
  "browser",
  "code_execution",
  "cron",
  "edit",
  "exec",
  "message",
  "process",
  "session_status",
  "sessions_send",
  "web_fetch",
  "web_search",
  "write",
]);
const MAX_BOOTSTRAP_FILE_BYTES = 4_000;
const MAX_BOOTSTRAP_TOTAL_BYTES = 10_000;
const SECRET_KEY = /token|password|cookie|credential|secret|private/i;

function issue(code, message, details = {}) {
  return { code, message, ...details };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sorted(values) {
  return values.toSorted((left, right) => left.localeCompare(right));
}

function findSecretKey(value, currentPath = []) {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      const found = findSecretKey(entry, [...currentPath, String(index)]);
      if (found) {
        return found;
      }
    }
    return null;
  }
  if (!isObject(value)) {
    return null;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) {
      return [...currentPath, key].join(".");
    }
    const found = findSecretKey(entry, [...currentPath, key]);
    if (found) {
      return found;
    }
  }
  return null;
}

async function readFileIfPresent(filePath) {
  try {
    return await fsp.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function fileExists(filePath) {
  try {
    const stat = await fsp.stat(filePath);
    return stat.isFile();
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function assertSafeRelativePath(relativePath) {
  const normalized = path.normalize(relativePath);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    throw new Error(`Unsafe managed path: ${relativePath}`);
  }
}

function destinationFor(workspaceRoot, relativePath) {
  assertSafeRelativePath(relativePath);
  const destination = path.resolve(workspaceRoot, relativePath);
  const relative = path.relative(path.resolve(workspaceRoot), destination);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Managed path escapes workspace: ${relativePath}`);
  }
  return destination;
}

function workspaceRelativePath(relativePath) {
  return relativePath.startsWith("workspace/")
    ? relativePath.slice("workspace/".length)
    : relativePath;
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return { parseError: `${label}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export function validateState(value) {
  const issues = [];
  if (!isObject(value)) {
    return [issue("state_not_object", "Program Manager state must be a JSON object.")];
  }
  const required = [
    "schemaVersion",
    "status",
    "evidenceStatus",
    "objective",
    "scope",
    "priorities",
    "blockers",
    "dependencies",
    "lastKnownGood",
    "unknowns",
    "source",
    "updatedAt",
  ];
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      issues.push(issue("state_field_missing", `State is missing ${key}.`, { field: key }));
    }
  }
  if (value.schemaVersion !== 1) {
    issues.push(issue("state_schema_unsupported", "State schemaVersion must be 1."));
  }
  if (!["Unknown", "Planning", "Blocked", "Complete"].includes(value.status)) {
    issues.push(issue("state_status_invalid", "State status is not a supported value."));
  }
  if (!["Unknown", "Confirmed"].includes(value.evidenceStatus)) {
    issues.push(
      issue("state_evidence_invalid", "State evidenceStatus must be Unknown or Confirmed."),
    );
  }
  if (
    !Array.isArray(value.scope) ||
    !Array.isArray(value.priorities) ||
    !Array.isArray(value.blockers) ||
    !Array.isArray(value.dependencies) ||
    !Array.isArray(value.unknowns)
  ) {
    issues.push(
      issue(
        "state_lists_invalid",
        "State scope, priorities, blockers, dependencies, and unknowns must be arrays.",
      ),
    );
  }
  if (
    !isObject(value.source) ||
    typeof value.source.kind !== "string" ||
    typeof value.source.label !== "string"
  ) {
    issues.push(issue("state_source_invalid", "State source must include kind and label."));
  }
  if (value.evidenceStatus === "Confirmed" && typeof value.source?.verifiedAt !== "string") {
    issues.push(
      issue("state_confirmation_without_time", "Confirmed state requires source.verifiedAt."),
    );
  }
  const secretPath = findSecretKey(value);
  if (secretPath) {
    issues.push(
      issue("state_secret_like_key", `State contains a disallowed sensitive key at ${secretPath}.`),
    );
  }
  return issues;
}

export function validateRuntimeEntry(value) {
  const issues = [];
  if (!isObject(value)) {
    return [
      issue("runtime_entry_invalid", "runtime-config.json must contain programManagerEntry."),
    ];
  }
  if (!Array.isArray(value.skills) || value.skills.length !== 0) {
    issues.push(issue("skills_not_empty", "Program Manager skills must be explicitly empty."));
  }
  if (value.skillsLimits?.maxSkillsPromptChars !== 0) {
    issues.push(issue("skills_budget_missing", "Program Manager maxSkillsPromptChars must be 0."));
  }
  if (value.bootstrapMaxChars !== 3500 || value.bootstrapTotalMaxChars !== 10000) {
    issues.push(
      issue(
        "bootstrap_budget_changed",
        "Bootstrap budgets must remain 3500 per file and 10000 total.",
      ),
    );
  }
  if (
    value.contextLimits?.memoryGetMaxChars !== 6000 ||
    value.contextLimits?.postCompactionMaxChars !== 2500
  ) {
    issues.push(
      issue(
        "context_budget_changed",
        "Context budgets must remain 6000 memory chars and 2500 post-compaction chars.",
      ),
    );
  }
  if (
    value.params?.maxTokens !== 3072 ||
    value.params?.text_verbosity !== "low" ||
    value.params?.cacheRetention !== "short"
  ) {
    issues.push(
      issue(
        "model_budget_changed",
        "Model parameters must keep the bounded low-verbosity profile.",
      ),
    );
  }
  if (value.thinkingDefault !== "low") {
    issues.push(issue("thinking_default_changed", "thinkingDefault must be low."));
  }
  const configuredAllowed = sorted(value.tools?.alsoAllow ?? []);
  if (JSON.stringify(configuredAllowed) !== JSON.stringify(sorted(ALLOWED_TOOLS))) {
    issues.push(
      issue(
        "tool_allowlist_changed",
        "Program Manager allowed tools must match the bounded allowlist.",
      ),
    );
  }
  const denied = new Set(value.tools?.deny ?? []);
  for (const tool of REQUIRED_DENIED_TOOLS) {
    if (!denied.has(tool)) {
      issues.push(issue("tool_deny_missing", `Program Manager must deny ${tool}.`, { tool }));
    }
  }
  if (value.tools?.exec?.security !== "deny" || value.tools?.exec?.ask !== "always") {
    issues.push(
      issue("execution_policy_changed", "Execution must remain denied and approval-gated."),
    );
  }
  if (value.tools?.fs?.workspaceOnly !== true || value.tools?.profile !== "minimal") {
    issues.push(
      issue(
        "filesystem_policy_changed",
        "Program Manager must use the minimal workspace-only profile.",
      ),
    );
  }
  if (value.subagents?.delegationMode !== "suggest" || value.subagents?.requireAgentId !== true) {
    issues.push(
      issue(
        "delegation_policy_changed",
        "Delegation must be suggest-only and require an explicit target.",
      ),
    );
  }
  if (
    JSON.stringify(sorted(value.subagents?.allowAgents ?? [])) !==
    JSON.stringify(["builder-agent", "research-brief-agent"])
  ) {
    issues.push(
      issue(
        "delegation_targets_changed",
        "Delegation targets must remain the two approved worker agents.",
      ),
    );
  }
  return issues;
}

export async function checkSource(sourceRoot = DEFAULT_SOURCE_ROOT) {
  const issues = [];
  let totalBootstrapBytes = 0;
  let largestBootstrapBytes = 0;
  for (const relativePath of MANAGED_FILES) {
    const filePath = path.join(sourceRoot, relativePath);
    if (!(await fileExists(filePath))) {
      issues.push(
        issue("managed_file_missing", `Managed file is missing: ${relativePath}.`, {
          file: relativePath,
        }),
      );
    }
  }
  for (const relativePath of BOOTSTRAP_FILES) {
    const filePath = path.join(sourceRoot, relativePath);
    const text = await readFileIfPresent(filePath);
    if (text === null) {
      continue;
    }
    const bytes = Buffer.byteLength(text, "utf8");
    totalBootstrapBytes += bytes;
    largestBootstrapBytes = Math.max(largestBootstrapBytes, bytes);
    if (bytes > MAX_BOOTSTRAP_FILE_BYTES) {
      issues.push(
        issue("bootstrap_file_too_large", `${relativePath} exceeds its context budget.`, {
          file: relativePath,
          bytes,
        }),
      );
    }
    if (text.includes("control/state/") || text.includes("PROGRAM_MANAGER_STATUS")) {
      issues.push(
        issue(
          "external_state_reference",
          `${relativePath} references a retired external state surface.`,
          { file: relativePath },
        ),
      );
    }
  }
  if (totalBootstrapBytes > MAX_BOOTSTRAP_TOTAL_BYTES) {
    issues.push(
      issue("bootstrap_total_too_large", "Bootstrap files exceed the total context budget.", {
        bytes: totalBootstrapBytes,
      }),
    );
  }
  const stateText = await readFileIfPresent(path.join(sourceRoot, "state/program-manager.json"));
  if (stateText !== null) {
    const parsed = parseJson(stateText, "state/program-manager.json");
    if (parsed.parseError) {
      issues.push(issue("state_invalid_json", parsed.parseError));
    } else {
      issues.push(...validateState(parsed));
    }
  }
  const runtimeText = await readFileIfPresent(path.join(sourceRoot, "runtime-config.json"));
  if (runtimeText !== null) {
    const parsed = parseJson(runtimeText, "runtime-config.json");
    if (parsed.parseError) {
      issues.push(issue("runtime_invalid_json", parsed.parseError));
    } else {
      issues.push(...validateRuntimeEntry(parsed.programManagerEntry));
    }
  }
  const contract = await readFileIfPresent(path.join(sourceRoot, "CONTRACT.md"));
  if (contract !== null) {
    for (const term of ["PLAN", "STATUS", "HANDOFF", "COMPLETION", "Unknown", "local model"]) {
      if (!contract.includes(term)) {
        issues.push(issue("contract_term_missing", `CONTRACT.md is missing ${term}.`, { term }));
      }
    }
  }
  const tools = await readFileIfPresent(path.join(sourceRoot, "workspace/TOOLS.md"));
  if (
    tools?.includes("Required output") ||
    tools?.includes("Milestones") ||
    tools?.includes("Acceptance Criteria")
  ) {
    issues.push(
      issue("tool_policy_duplication", "TOOLS.md must not repeat semantic output policy."),
    );
  }
  return {
    ok: issues.length === 0,
    issues,
    metrics: {
      managedFiles: MANAGED_FILES.length,
      bootstrapFiles: BOOTSTRAP_FILES.length,
      totalBootstrapBytes,
      largestBootstrapBytes,
      maxBootstrapFileBytes: MAX_BOOTSTRAP_FILE_BYTES,
      maxBootstrapTotalBytes: MAX_BOOTSTRAP_TOTAL_BYTES,
    },
  };
}

export async function checkRuntimeConfig(configPath) {
  const text = await fsp.readFile(configPath, "utf8");
  const config = parseJson(text, configPath);
  if (config.parseError) {
    return { ok: false, issues: [issue("config_invalid_json", config.parseError)] };
  }
  if (isObject(config.programManagerEntry)) {
    const result = validateRuntimeEntry(config.programManagerEntry);
    return { ok: result.length === 0, issues: result };
  }
  const entries = Array.isArray(config.agents?.list)
    ? config.agents.list
    : isObject(config.agents?.entries)
      ? Object.entries(config.agents.entries).map(([id, entry]) => Object.assign({ id }, entry))
      : [];
  const entry = entries.find((candidate) => candidate?.id === "program-manager");
  if (!entry) {
    return {
      ok: false,
      issues: [issue("agent_missing", "Configured Program Manager entry was not found.")],
    };
  }
  const result = validateRuntimeEntry(entry);
  return { ok: result.length === 0, issues: result };
}

export async function installWorkspace({
  sourceRoot = DEFAULT_SOURCE_ROOT,
  workspaceRoot,
  backupRoot,
}) {
  if (!workspaceRoot || !backupRoot) {
    throw new Error("install requires --workspace and --backup-dir");
  }
  const sourceCheck = await checkSource(sourceRoot);
  if (!sourceCheck.ok) {
    throw new Error(`Source check failed: ${JSON.stringify(sourceCheck.issues)}`);
  }
  if (await fileExists(path.join(backupRoot, "restore.json"))) {
    throw new Error("Backup directory is already in use.");
  }
  await fsp.mkdir(path.join(backupRoot, "files"), { recursive: true });
  const restore = { files: [] };
  for (const relativePath of MANAGED_FILES) {
    const destinationRelativePath = workspaceRelativePath(relativePath);
    const destination = destinationFor(workspaceRoot, destinationRelativePath);
    const source = path.join(sourceRoot, relativePath);
    const existed = await fileExists(destination);
    restore.files.push({ relativePath: destinationRelativePath, existed });
    if (existed) {
      const backup = path.join(backupRoot, "files", destinationRelativePath);
      await fsp.mkdir(path.dirname(backup), { recursive: true });
      await fsp.copyFile(destination, backup);
    }
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    await fsp.copyFile(source, destination);
  }
  await fsp.writeFile(
    path.join(backupRoot, "restore.json"),
    `${JSON.stringify(restore, null, 2)}\n`,
    "utf8",
  );
  return { ok: true, managedFiles: MANAGED_FILES.length, backupRoot };
}

export async function rollbackWorkspace({ workspaceRoot, backupRoot }) {
  if (!workspaceRoot || !backupRoot) {
    throw new Error("rollback requires --workspace and --backup-dir");
  }
  const restoreText = await fsp.readFile(path.join(backupRoot, "restore.json"), "utf8");
  const restore = JSON.parse(restoreText);
  if (!Array.isArray(restore.files)) {
    throw new Error("Backup restore record is invalid.");
  }
  for (const entry of restore.files) {
    const destination = destinationFor(workspaceRoot, entry.relativePath);
    if (entry.existed) {
      await fsp.copyFile(path.join(backupRoot, "files", entry.relativePath), destination);
    } else if (await fileExists(destination)) {
      await fsp.unlink(destination);
    }
  }
  return { ok: true, restoredFiles: restore.files.length };
}

function parseArgs(argv) {
  const args = { command: "check", sourceRoot: DEFAULT_SOURCE_ROOT, json: false };
  let index = 0;
  if (argv[0] && !argv[0].startsWith("-")) {
    args.command = argv[index++];
  }
  while (index < argv.length) {
    const arg = argv[index++];
    if (arg === "--source") {
      args.sourceRoot = argv[index++];
    } else if (arg === "--workspace") {
      args.workspaceRoot = argv[index++];
    } else if (arg === "--backup-dir") {
      args.backupRoot = argv[index++];
    } else if (arg === "--config") {
      args.configPath = argv[index++];
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function printResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`Program Manager workspace: ${result.ok ? "passed" : "failed"}`);
  if (result.metrics) {
    console.log(
      `Bootstrap bytes: ${result.metrics.totalBootstrapBytes}/${result.metrics.maxBootstrapTotalBytes}`,
    );
  }
  for (const entry of result.issues ?? []) {
    console.log(`- ${entry.code}: ${entry.message}`);
  }
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(
      "Usage: node scripts/program-manager-workspace.mjs [check|check-config|install|rollback] [options]",
    );
    return;
  }
  let result;
  if (args.command === "check") {
    result = await checkSource(args.sourceRoot);
  } else if (args.command === "check-config") {
    if (!args.configPath) {
      throw new Error("check-config requires --config");
    }
    result = await checkRuntimeConfig(args.configPath);
  } else if (args.command === "install") {
    result = await installWorkspace({
      sourceRoot: args.sourceRoot,
      workspaceRoot: args.workspaceRoot,
      backupRoot: args.backupRoot,
    });
  } else if (args.command === "rollback") {
    result = await rollbackWorkspace({
      workspaceRoot: args.workspaceRoot,
      backupRoot: args.backupRoot,
    });
  } else {
    throw new Error(`Unknown command: ${args.command}`);
  }
  printResult(result, args.json);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

function handleMainError(error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch(handleMainError);
}

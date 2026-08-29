#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  AGENT_ROLE_CONTRACT_BY_ID,
  evaluateAgentRoleContractCatalog,
} from "./lib/agent-role-evals.mjs";

export const STEWARD_MVP_AGENT_ID = "browser-session-credential-steward";
export const STEWARD_MVP_MODEL = "openai/gpt-5.6-luna";
export const STEWARD_MVP_TOOLS = ["browser", "session_status"];

const REQUIRED_SOURCE_FILES = [
  "extensions/browser/src/browser/browser-steward-runtime-guard.ts",
  "extensions/browser/src/browser/credential-steward-policy.ts",
  "src/gateway/session-steward-boundary.ts",
  "src/sessions/session-steward-policy.ts",
  "scripts/lib/agent-role-evals.mjs",
];

const REQUIRED_BUILD_GLOBS = [
  "plugin-sdk/browser-steward-runtime.js",
  "plugin-sdk/browser-node-delegation-runtime.js",
  "session-steward-boundary-",
  "browser-steward-approval-",
];

const FAILURE_CODES = Object.freeze({
  CATALOG: "role_catalog_failed",
  CONTRACT: "role_contract_missing",
  SOURCE_FILE: "source_file_missing",
  CONFIG: "config_missing_or_invalid",
  AGENT: "steward_agent_missing",
  MODEL: "model_not_pinned",
  FALLBACK: "model_fallbacks_enabled",
  TOOLS: "tool_allowlist_not_exact",
  BUILD: "steward_build_missing",
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function resolveModel(agent) {
  if (typeof agent?.model === "string") {
    return { primary: agent.model, fallbacks: [] };
  }
  return {
    primary: agent?.model?.primary,
    fallbacks: Array.isArray(agent?.model?.fallbacks) ? agent.model.fallbacks : [],
  };
}

function normalizedToolList(value) {
  return Array.isArray(value) && value.every(nonEmptyString)
    ? [...new Set(value.map((item) => item.trim()))].toSorted((left, right) =>
        left.localeCompare(right),
      )
    : null;
}

function sameStringList(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function evaluateStewardMvpConfig(config) {
  const result = {
    configured: false,
    modelPinned: false,
    fallbacksDisabled: false,
    toolsPinned: false,
    ok: false,
    failures: [],
  };
  const entries = config?.agents?.entries;
  if (!isRecord(entries)) {
    result.failures.push(FAILURE_CODES.CONFIG);
    return result;
  }
  const agent = entries[STEWARD_MVP_AGENT_ID];
  if (!isRecord(agent)) {
    result.failures.push(FAILURE_CODES.AGENT);
    return result;
  }
  result.configured = true;

  const model = resolveModel(agent);
  result.modelPinned = model.primary === STEWARD_MVP_MODEL;
  if (!result.modelPinned) {
    result.failures.push(FAILURE_CODES.MODEL);
  }
  result.fallbacksDisabled = model.fallbacks.length === 0;
  if (!result.fallbacksDisabled) {
    result.failures.push(FAILURE_CODES.FALLBACK);
  }

  const tools = agent.tools;
  const allow = normalizedToolList(tools?.allow);
  result.toolsPinned =
    isRecord(tools) &&
    allow !== null &&
    sameStringList(
      allow,
      [...STEWARD_MVP_TOOLS].toSorted((left, right) => left.localeCompare(right)),
    ) &&
    tools.profile === undefined &&
    tools.alsoAllow === undefined &&
    tools.deny === undefined;
  if (!result.toolsPinned) {
    result.failures.push(FAILURE_CODES.TOOLS);
  }
  result.ok = result.failures.length === 0;
  return result;
}

export function evaluateStewardMvpSource(root) {
  const failures = [];
  for (const relativePath of REQUIRED_SOURCE_FILES) {
    if (!fs.existsSync(path.join(root, relativePath))) {
      failures.push(`${FAILURE_CODES.SOURCE_FILE}:${relativePath}`);
    }
  }
  const catalog = evaluateAgentRoleContractCatalog();
  if (!catalog.ok) {
    failures.push(FAILURE_CODES.CATALOG);
  }
  if (!AGENT_ROLE_CONTRACT_BY_ID.has(STEWARD_MVP_AGENT_ID)) {
    failures.push(FAILURE_CODES.CONTRACT);
  }
  return {
    ok: failures.length === 0,
    catalogOk: catalog.ok,
    stewardContractPresent: AGENT_ROLE_CONTRACT_BY_ID.has(STEWARD_MVP_AGENT_ID),
    failures,
  };
}

export function evaluateStewardMvpBuild(root) {
  const distRoot = path.join(root, "dist");
  let files = [];
  if (fs.existsSync(distRoot)) {
    files = fs.readdirSync(distRoot, { recursive: true }).map(String);
  }
  const failures = REQUIRED_BUILD_GLOBS.filter((required) => {
    if (required.endsWith(".js")) {
      return !files.includes(required);
    }
    return !files.some((file) => file.startsWith(required));
  }).map((required) => `${FAILURE_CODES.BUILD}:${required}`);
  return {
    ok: failures.length === 0,
    failures,
  };
}

function usage() {
  return [
    "Usage: node scripts/steward-mvp-verify.mjs --source-only [--json]",
    "       node scripts/steward-mvp-verify.mjs --build-only --runtime-root <path> [--json]",
    "       node scripts/steward-mvp-verify.mjs --config <path> --runtime-root <path> [--json]",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {
    json: false,
    sourceOnly: false,
    buildOnly: false,
    configPath: null,
    runtimeRoot: process.cwd(),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      args.json = true;
    } else if (arg === "--source-only") {
      args.sourceOnly = true;
    } else if (arg === "--build-only") {
      args.buildOnly = true;
    } else if (arg === "--config") {
      args.configPath = argv[++index];
    } else if (arg === "--runtime-root") {
      args.runtimeRoot = argv[++index];
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.sourceOnly && !args.buildOnly && !nonEmptyString(args.configPath)) {
    throw new Error("--config is required unless --source-only is set");
  }
  if (args.sourceOnly && args.buildOnly) {
    throw new Error("--source-only and --build-only cannot be combined");
  }
  return args;
}

function loadConfig(configPath) {
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return null;
  }
}

export function evaluateStewardMvpReadiness({
  root,
  config = null,
  sourceOnly = false,
  buildOnly = false,
}) {
  const source = evaluateStewardMvpSource(root);
  const configResult =
    sourceOnly || buildOnly
      ? { ok: true, skipped: true, failures: [] }
      : { ...evaluateStewardMvpConfig(config), skipped: false };
  const build = sourceOnly
    ? { ok: true, skipped: true, failures: [] }
    : { ...evaluateStewardMvpBuild(root), skipped: false };
  return {
    ok: source.ok && configResult.ok && build.ok,
    source,
    config: configResult,
    build,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const result = evaluateStewardMvpReadiness({
    root: path.resolve(args.runtimeRoot),
    config: args.sourceOnly || args.buildOnly ? null : loadConfig(path.resolve(args.configPath)),
    sourceOnly: args.sourceOnly,
    buildOnly: args.buildOnly,
  });
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Steward MVP readiness: ${result.ok ? "passed" : "failed"}`);
    for (const failure of [
      ...result.source.failures,
      ...result.config.failures,
      ...result.build.failures,
    ]) {
      console.log(`- ${failure}`);
    }
  }
  process.exitCode = result.ok ? 0 : 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

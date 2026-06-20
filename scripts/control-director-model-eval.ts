#!/usr/bin/env node
/** Deterministic qualification gate for alternate Control Director models. */
import process from "node:process";
import { evaluateControlDirectorModelCandidate } from "../src/agents/control-director-model-eval.js";
import { DEFAULT_PROVIDER } from "../src/agents/defaults.js";
import { loadManifestModelCatalog } from "../src/agents/model-catalog.js";
import { resolveDefaultModelForAgent } from "../src/agents/model-selection.js";
import { getRuntimeConfig } from "../src/config/io.js";

function usage() {
  return [
    "Usage: pnpm control-director:model-eval -- --model <provider/model> [--json]",
    "",
    "Runs deterministic Control Director qualification checks before an alternate model is trusted.",
    "This command does not change the configured default model.",
  ].join("\n");
}

function parseArgs(argv: string[]) {
  const args: { model?: string; json?: boolean; help?: boolean } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    if (arg === "--model") {
      args.model = argv[++index];
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.model?.trim()) {
    throw new Error("Missing --model");
  }

  const cfg = getRuntimeConfig();
  const defaultRef = resolveDefaultModelForAgent({ cfg, agentId: "main" });
  const catalog = loadManifestModelCatalog({ config: cfg, workspaceDir: process.cwd() });
  const result = evaluateControlDirectorModelCandidate({
    cfg,
    catalog,
    raw: args.model,
    defaultProvider: defaultRef.provider || DEFAULT_PROVIDER,
    defaultModel: defaultRef.model,
  });

  if (args.json) {
    console.log(JSON.stringify({ ok: result.passed, result }, null, 2));
  } else {
    console.log(`Control Director model eval: ${result.passed ? "PASS" : "FAIL"}`);
    console.log(`Model: ${result.model}`);
    if (result.provider && result.resolvedModel) {
      console.log(`Resolved: ${result.provider}/${result.resolvedModel}`);
    }
    console.log(`Score: ${result.score}`);
    console.log(`Eligible: ${result.eligibleForControlDirector ? "yes" : "no"}`);
    for (const entry of result.cases) {
      console.log(`${entry.passed ? "✓" : "✗"} ${entry.id}: ${entry.summary}`);
    }
    for (const warning of result.warnings) {
      console.log(`Warning: ${warning}`);
    }
    console.log(`Recommendation: ${result.recommendation}`);
  }

  if (!result.passed) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

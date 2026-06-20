#!/usr/bin/env node
/** CLI preflight for trying a Control Director model selection safely. */
import process from "node:process";
import { resolveControlDirectorModelSelectionPreflight } from "../src/agents/control-director-model-selection.js";
import { DEFAULT_PROVIDER } from "../src/agents/defaults.js";
import { loadManifestModelCatalog } from "../src/agents/model-catalog.js";
import { resolveDefaultModelForAgent } from "../src/agents/model-selection.js";
import { getRuntimeConfig } from "../src/config/io.js";

function usage() {
  return [
    "Usage: pnpm control-director:model-check -- --model <provider/model> [--json]",
    "",
    "Checks whether a selected model is safe to use for the Control Director before sending a live request.",
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
  const result = resolveControlDirectorModelSelectionPreflight({
    cfg,
    catalog,
    raw: args.model,
    defaultProvider: defaultRef.provider || DEFAULT_PROVIDER,
    defaultModel: defaultRef.model,
  });
  if (args.json) {
    console.log(
      JSON.stringify(
        {
          ok: result.ok,
          model: args.model,
          defaultRef,
          result,
        },
        null,
        2,
      ),
    );
  } else if (result.ok) {
    console.log(`OK: ${result.provider}/${result.model}`);
    for (const warning of result.warnings) {
      console.log(`Warning: ${warning}`);
    }
  } else {
    console.error(`Blocked: ${result.error}`);
    console.error(`Fix: ${result.guidance}`);
  }
  if (!result.ok) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

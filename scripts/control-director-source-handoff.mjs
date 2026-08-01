#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runSourceHandoffCli } from "./control-director-source-handoff/cli.mjs";

export { normalizeSourceHandoffPolicy } from "./control-director-source-handoff/policy.mjs";
export { evaluateSourceHandoffPreflight } from "./control-director-source-handoff/preflight.mjs";
export {
  CONTROL_DIRECTOR_SOURCE_HANDOFF_POLICY_PATH,
  CONTROL_DIRECTOR_SOURCE_HANDOFF_REPO_ROOT,
  normalizeRemoteUrl,
  SOURCE_HANDOFF_SCHEMA,
  SOURCE_HANDOFF_STATES,
  validateSourceHandoffBranch,
} from "./control-director-source-handoff/shared.mjs";
export { readSourceHandoffGitState } from "./control-director-source-handoff/git-state.mjs";
export { runSourceHandoff } from "./control-director-source-handoff/workflow.mjs";

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = runSourceHandoffCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

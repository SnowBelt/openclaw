#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";
import {
  buildControlDirectorModelEvalMatrix,
  parseControlDirectorModelEvalTrials,
} from "../src/agents/control-director-model-eval.js";

function usage(): never {
  throw new Error(
    "Usage: pnpm control-director:eval -- --input <trials.json> --source-sha <sha> [--json]. Exact-runtime evidence is required; deterministic contract tests are run by Vitest.",
  );
}

function parse(argv: string[]) {
  let inputPath = "";
  let sourceSha = "";
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--input") inputPath = argv[++index] ?? "";
    else if (value === "--source-sha") sourceSha = argv[++index] ?? "";
    else if (value === "--json") json = true;
    else if (value === "--") continue;
    else usage();
  }
  if (!inputPath || !/^[a-f0-9]{40}$/iu.test(sourceSha)) usage();
  return { inputPath, sourceSha, json };
}

const args = parse(process.argv.slice(2));
const trials = parseControlDirectorModelEvalTrials(
  JSON.parse(fs.readFileSync(args.inputPath, "utf8")),
);
const matrix = buildControlDirectorModelEvalMatrix({
  trials,
  exactRuntime: true,
  sourceSha: args.sourceSha,
});
if (args.json) {
  process.stdout.write(`${JSON.stringify(matrix, null, 2)}\n`);
} else {
  process.stdout.write(
    `Control Director model eval: ${matrix.passed ? "PASS" : "FAIL"}; ${matrix.passRate}% trials; ${matrix.criticalOmissions} critical omissions.\n`,
  );
}
process.exitCode = matrix.passed ? 0 : 1;

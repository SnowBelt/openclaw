#!/usr/bin/env node
import process from "node:process";
import { runControlDirectorInstructionTortureSuite } from "../src/agents/control-director-instruction-torture.js";

const report = runControlDirectorInstructionTortureSuite();
if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write(
    `Control Director torture suite: ${report.accepted ? "PASS" : "FAIL"}; ${report.passed}/${report.total} (${report.passRate}%); ${report.criticalOmissions} critical omissions.\n`,
  );
}
process.exitCode = report.accepted ? 0 : 1;

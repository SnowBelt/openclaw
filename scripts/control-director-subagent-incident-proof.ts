#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runControlDirectorSubagentIncidentBaseline } from "./lib/control-director-subagent-incident-audit.js";

function git(repoRoot: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}

function readOutputPath(args: string[]): string | undefined {
  const index = args.indexOf("--output");
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1]?.trim();
  if (!value) {
    throw new Error("--output requires a path");
  }
  return value;
}

export function createControlDirectorSubagentIncidentProof(params: {
  repoRoot: string;
  generatedAt?: string;
}) {
  const sourceSha = git(params.repoRoot, ["rev-parse", "HEAD"]);
  const sourceClean = git(params.repoRoot, ["status", "--porcelain"]) === "";
  const baseline = runControlDirectorSubagentIncidentBaseline();
  return {
    schema: "openclaw.control-director.subagent-incident-baseline.v1",
    milestone: "M62",
    sourceSha,
    sourceClean,
    generatedAt: params.generatedAt ?? new Date().toISOString(),
    ...baseline,
  };
}

function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const receipt = createControlDirectorSubagentIncidentProof({ repoRoot });
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  const output = readOutputPath(process.argv.slice(2));
  if (output) {
    const absoluteOutput = path.resolve(repoRoot, output);
    fs.mkdirSync(path.dirname(absoluteOutput), { recursive: true });
    fs.writeFileSync(absoluteOutput, serialized);
  } else {
    process.stdout.write(serialized);
  }
  if (!receipt.sourceClean || !receipt.passed) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const CONTROL_DIRECTOR_FORMAT_REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const ROADMAP_PATH = path.join(
  CONTROL_DIRECTOR_FORMAT_REPO_ROOT,
  "work/control-director/reliability-v1/roadmap.json",
);
const IMMUTABLE_SHA = /^[a-f0-9]{40}$/u;

function git(args) {
  const result = spawnSync("git", args, {
    cwd: CONTROL_DIRECTOR_FORMAT_REPO_ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${(result.stderr || result.stdout || "unknown error").trim()}`,
    );
  }
  return result.stdout.trim();
}

export function selectControlDirectorFormatPaths(output) {
  return String(output ?? "")
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => !entry.startsWith(".artifacts/"))
    .toSorted();
}

export function readControlDirectorBaselineSha(roadmap) {
  const sha = String(roadmap?.baseline?.sourceSha ?? "")
    .trim()
    .toLowerCase();
  if (!IMMUTABLE_SHA.test(sha)) {
    throw new Error("Control Director roadmap baseline must be an immutable 40-character SHA.");
  }
  return sha;
}

function main() {
  const roadmap = JSON.parse(fs.readFileSync(ROADMAP_PATH, "utf8"));
  const baselineSha = readControlDirectorBaselineSha(roadmap);
  const headSha = git(["rev-parse", "HEAD"]).toLowerCase();
  const ancestor = spawnSync("git", ["merge-base", "--is-ancestor", baselineSha, headSha], {
    cwd: CONTROL_DIRECTOR_FORMAT_REPO_ROOT,
    stdio: "ignore",
  });
  if (ancestor.status !== 0) {
    throw new Error(
      `Control Director baseline ${baselineSha} is not an ancestor of source ${headSha}.`,
    );
  }
  const paths = selectControlDirectorFormatPaths(
    git(["diff", "--name-only", "--diff-filter=ACMRT", `${baselineSha}..${headSha}`]),
  );
  if (paths.length === 0) {
    throw new Error("Control Director source diff is empty; scoped formatting proof cannot pass.");
  }
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(pnpm, ["exec", "oxfmt", "--check", "--threads=1", ...paths], {
    cwd: CONTROL_DIRECTOR_FORMAT_REPO_ROOT,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`Control Director scoped format check failed with status ${result.status}.`);
  }
  console.log(`Control Director scoped format check passed for ${paths.length} changed files.`);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

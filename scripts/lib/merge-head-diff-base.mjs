// Resolves the diff base for merge commits when first-parent comparison is requested.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const DEFAULT_GIT_OUTPUT_MAX_BUFFER = 16 * 1024 * 1024;
const DEFAULT_BASE_REF = "origin/main";
const LOCAL_BASE_FALLBACK_REFS = [
  "refs/remotes/origin/HEAD",
  "refs/heads/main",
  "refs/remotes/origin/master",
  "refs/heads/master",
];

/**
 * Resolve a base ref without fetching. Isolated worktrees commonly omit
 * origin/main but retain the remote's advertised default ref; use that only
 * for the default base and fail closed for every other missing ref.
 */
export function resolveAvailableDiffBase({
  base,
  cwd = process.cwd(),
  maxBuffer = DEFAULT_GIT_OUTPUT_MAX_BUFFER,
}) {
  if (!base) {
    return "";
  }
  if (resolveCommit({ ref: base, cwd, maxBuffer })) {
    return base;
  }
  if (base !== DEFAULT_BASE_REF) {
    throw new Error(`Changed-lanes base ref is unavailable: ${base}`);
  }
  for (const fallback of LOCAL_BASE_FALLBACK_REFS) {
    if (resolveCommit({ ref: fallback, cwd, maxBuffer })) {
      return fallback;
    }
  }
  throw new Error(
    `Changed-lanes base ref is unavailable: ${base}; no local canonical baseline is present`,
  );
}

/** Resolve the git base ref to use when diffing a merge head. */
export function resolveMergeHeadDiffBase({
  base,
  head = "HEAD",
  cwd = process.cwd(),
  maxBuffer = DEFAULT_GIT_OUTPUT_MAX_BUFFER,
  preferFirstParent = false,
}) {
  if (!base) {
    return "";
  }
  if (!preferFirstParent) {
    return base;
  }

  const parents = listCommitParents({ ref: head, cwd, maxBuffer });
  if (parents.length < 2) {
    return base;
  }

  const firstParent = resolveCommit({ ref: parents[0], cwd, maxBuffer });
  const explicitBase = resolveCommit({ ref: base, cwd, maxBuffer });
  if (!firstParent || firstParent === explicitBase) {
    return base;
  }

  return firstParent;
}

function listCommitParents({ ref, cwd, maxBuffer }) {
  try {
    const output = execFileSync("git", ["rev-list", "--parents", "-n", "1", ref], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
      maxBuffer,
    }).trim();
    return output.split(/\s+/u).slice(1);
  } catch {
    return [];
  }
}

function resolveCommit({ ref, cwd, maxBuffer }) {
  try {
    return execFileSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
      maxBuffer,
    }).trim();
  } catch {
    return "";
  }
}

function readRefValue(argv, index, optionName) {
  const value = argv[index + 1];
  if (value === undefined || value === "" || value.startsWith("-")) {
    throw new Error(`${optionName} requires a value`);
  }
  return value;
}

export function parseArgs(argv) {
  const args = {
    base: "",
    head: "HEAD",
    preferFirstParent: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base") {
      args.base = readRefValue(argv, index, "--base");
      index += 1;
      continue;
    }
    if (arg === "--head") {
      args.head = readRefValue(argv, index, "--head");
      index += 1;
      continue;
    }
    if (arg === "--prefer-first-parent") {
      args.preferFirstParent = true;
    }
  }
  return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  process.stdout.write(
    `${resolveMergeHeadDiffBase({
      base: args.base,
      head: args.head,
      preferFirstParent: args.preferFirstParent,
    })}\n`,
  );
}

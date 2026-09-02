#!/usr/bin/env node
// Runs local workflow sanity checks.
// Uses installed tools when present, otherwise falls back to pinned hooks where
// possible, then runs repo-specific workflow guards.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ACTIONLINT_VERSION = "1.7.11";
const PRE_COMMIT_VERSION = "4.2.0";
const WORKFLOW_DIR = ".github/workflows";

function commandExists(command, args = ["--version"]) {
  const result = spawnSync(command, args, { stdio: "ignore" });
  return !result.error && result.status === 0;
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) {
    console.error(`[check-workflows] failed to run ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runChecked(command, args, env = process.env) {
  const result = spawnSync(command, args, { env, stdio: "inherit" });
  if (result.error) {
    return {
      message: `[check-workflows] failed to run ${command}: ${result.error.message}`,
      status: 1,
    };
  }
  if (result.status !== 0) {
    return {
      message: null,
      status: result.status ?? 1,
    };
  }
  return null;
}

function exitWithFailure(failure) {
  if (failure.message) {
    console.error(failure.message);
  }
  process.exit(failure.status);
}

function runPreCommitFromTempVenv(hook, hookArgs, env = process.env) {
  if (!commandExists("python3", ["--version"])) {
    return false;
  }
  const venvDir = mkdtempSync(join(tmpdir(), "openclaw-check-workflows-pre-commit-"));
  const python = join(venvDir, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  let postVenvFailure;
  try {
    const venvFailure = runChecked("python3", ["-m", "venv", venvDir], env);
    if (venvFailure) {
      return false;
    }
    postVenvFailure = runChecked(
      python,
      ["-m", "pip", "install", "--disable-pip-version-check", `pre-commit==${PRE_COMMIT_VERSION}`],
      env,
    );
    if (postVenvFailure) {
      return false;
    }
    postVenvFailure = runChecked(python, ["-m", "pre_commit", ...hookArgs], env);
    if (postVenvFailure) {
      return false;
    }
    return true;
  } finally {
    rmSync(venvDir, { force: true, recursive: true });
    if (postVenvFailure) {
      exitWithFailure(postVenvFailure);
    }
  }
}

function workflowFiles() {
  return readdirSync(WORKFLOW_DIR)
    .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
    .toSorted()
    .map((file) => join(WORKFLOW_DIR, file));
}

function runPreCommitHook(hook, files) {
  const hookArgs = ["run", "--config", ".pre-commit-config.yaml", hook, "--files", ...files];
  const preCommitHome = mkdtempSync(join(tmpdir(), "openclaw-check-workflows-pre-commit-home-"));
  const env = { ...process.env, PRE_COMMIT_HOME: preCommitHome };
  let failure;
  let selected = false;
  try {
    if (commandExists("pre-commit")) {
      selected = true;
      failure = runChecked("pre-commit", hookArgs, env);
    } else if (commandExists("python3", ["-m", "pre_commit", "--version"])) {
      selected = true;
      failure = runChecked("python3", ["-m", "pre_commit", ...hookArgs], env);
    }
  } finally {
    rmSync(preCommitHome, { force: true, recursive: true });
  }
  if (selected) {
    if (failure) {
      exitWithFailure(failure);
    }
    return;
  }
  if (runPreCommitFromTempVenv(hook, hookArgs, env)) {
    return;
  }

  console.error(
    `[check-workflows] missing pre-commit runtime for ${hook}: install pre-commit or Python venv support for pre-commit ${PRE_COMMIT_VERSION}.`,
  );
  process.exit(1);
}

const workflows = workflowFiles();

if (commandExists("actionlint")) {
  run("actionlint", workflows);
} else if (commandExists("go", ["version"])) {
  run("go", ["run", `github.com/rhysd/actionlint/cmd/actionlint@v${ACTIONLINT_VERSION}`]);
} else if (
  commandExists("pre-commit") ||
  commandExists("python3", ["-m", "pre_commit", "--version"]) ||
  commandExists("python3", ["--version"])
) {
  runPreCommitHook("actionlint", workflows);
} else {
  console.error(
    `[check-workflows] missing workflow linter: install actionlint, Go ${ACTIONLINT_VERSION} fallback support, or pre-commit.`,
  );
  process.exit(1);
}

runPreCommitHook("zizmor", workflows);

run("python3", ["scripts/check-composite-action-input-interpolation.py"]);
run("node", ["scripts/check-no-conflict-markers.mjs"]);

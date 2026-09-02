#!/usr/bin/env node
// Publish one prepared candidate to the private SnowBelt fork and bind the
// repository-native exact-SHA proof to a locally verifiable receipt.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const RECEIPT_SCHEMA = "openclaw.custom-runtime-github-proof.v1";
const REPOSITORY = "SnowBelt/openclaw";
const REMOTE_URL = "https://github.com/SnowBelt/openclaw.git";
const WORKFLOW = "control-director-reliability.yml";
const WORKFLOW_NAME = "Control Director Reliability";
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const BRANCH_PATTERN = /^codex\/runtime-update-[0-9]{8}T[0-9]{6}Z$/u;
const DEFAULT_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const DEFAULT_POLL_MS = 15_000;
const MAX_RECEIPT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u;

function fail(message) {
  throw new Error(`custom runtime GitHub proof blocked: ${message}`);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: options.timeoutMs ?? 5 * 60 * 1000,
  });
  if (result.error || result.status !== 0) {
    const reason = result.error?.message ?? result.signal ?? result.status ?? "unknown";
    fail(`${command} failed (${reason}): ${(result.stderr ?? "").trim()}`);
  }
  return result.stdout.trim();
}

function writeAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
  fs.chmodSync(filePath, 0o600);
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function parseOptions(argv) {
  const [command, ...rest] = argv;
  const values = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      fail(`invalid argument near ${key ?? "<end>"}`);
    }
    values.set(key.slice(2), value);
  }
  return { command, values };
}

function expectedRunName(sha, branch) {
  return `${WORKFLOW_NAME} / ${sha} / ${branch}`;
}

function validateTrustedWorkflowRef(value) {
  if (
    typeof value !== "string" ||
    !REF_PATTERN.test(value) ||
    value.includes("..") ||
    value.includes("//") ||
    value.endsWith("/")
  ) {
    fail("trusted workflow ref is invalid");
  }
  return value;
}

function readTrustedWorkflowRef() {
  return validateTrustedWorkflowRef(
    run("gh", [
      "repo",
      "view",
      REPOSITORY,
      "--json",
      "defaultBranchRef",
      "--jq",
      ".defaultBranchRef.name",
    ]),
  );
}

function assertStandaloneCheckout(root) {
  const gitDirectory = path.join(root, ".git");
  let info;
  try {
    info = fs.lstatSync(gitDirectory);
  } catch {
    fail("candidate source Git directory is missing");
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    fail("candidate source must be a standalone Git checkout");
  }
  if (!fs.existsSync(path.join(gitDirectory, "objects"))) {
    fail("candidate source object database is missing");
  }
  if (fs.existsSync(path.join(gitDirectory, "commondir"))) {
    fail("candidate source uses a shared Git directory");
  }
  const gitDirectoryResolved = path.resolve(
    root,
    run("git", ["rev-parse", "--git-dir"], { cwd: root }),
  );
  const commonDirectoryResolved = path.resolve(
    root,
    run("git", ["rev-parse", "--git-common-dir"], { cwd: root }),
  );
  if (gitDirectoryResolved !== commonDirectoryResolved) {
    fail("candidate source uses a shared Git directory");
  }
  const branch = run("git", ["branch", "--show-current"], { cwd: root });
  if (!branch) {
    fail("candidate source must be an attached branch checkout");
  }
}

function validateIdentity({ source, sha, branch }) {
  if (!SHA_PATTERN.test(sha)) {
    fail("candidate SHA must be an exact 40-character lowercase Git SHA");
  }
  if (!BRANCH_PATTERN.test(branch)) {
    fail("candidate branch is outside the managed runtime-update namespace");
  }
  const sourceRoot = fs.realpathSync(path.resolve(source));
  const info = fs.lstatSync(sourceRoot);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    fail("candidate source is not a regular directory");
  }
  assertStandaloneCheckout(sourceRoot);
  if (run("git", ["branch", "--show-current"], { cwd: sourceRoot }) !== branch) {
    fail("candidate source branch does not match the requested branch");
  }
  if (run("git", ["rev-parse", "HEAD"], { cwd: sourceRoot }) !== sha) {
    fail("candidate source HEAD does not match the requested exact SHA");
  }
  if (run("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: sourceRoot })) {
    fail("candidate source is dirty");
  }
  run("git", ["fsck", "--full", "--strict"], { cwd: sourceRoot, timeoutMs: 15 * 60 * 1000 });
  return sourceRoot;
}

function parseRuns(stdout) {
  const value = JSON.parse(stdout);
  if (!Array.isArray(value) || value.some((item) => !isRecord(item))) {
    fail("GitHub run listing is malformed");
  }
  return value;
}

function exactRun(runs, sha, branch, trustedWorkflowRef, notBefore) {
  const matches = runs.filter((candidateRun) => {
    const createdAt = Date.parse(String(candidateRun.createdAt ?? ""));
    return (
      candidateRun.workflowName === WORKFLOW_NAME &&
      candidateRun.event === "workflow_dispatch" &&
      candidateRun.headBranch === trustedWorkflowRef &&
      candidateRun.displayTitle === expectedRunName(sha, branch) &&
      Number.isFinite(createdAt) &&
      createdAt >= notBefore - 60_000
    );
  });
  if (matches.length !== 1) {
    fail("GitHub did not return exactly one newly dispatched exact-SHA workflow run");
  }
  return matches[0];
}

function readRun(runId) {
  const raw = run("gh", [
    "run",
    "view",
    String(runId),
    "--repo",
    REPOSITORY,
    "--json",
    "databaseId,headBranch,headSha,status,conclusion,url,workflowName,displayTitle,event,createdAt,updatedAt,jobs",
  ]);
  const value = JSON.parse(raw);
  if (!isRecord(value)) {
    fail("GitHub run detail is malformed");
  }
  return value;
}

function assertSuccessfulRun(runInfo, sha, branch, trustedWorkflowRef) {
  if (
    !SHA_PATTERN.test(String(runInfo.headSha ?? "")) ||
    runInfo.headBranch !== trustedWorkflowRef ||
    runInfo.displayTitle !== expectedRunName(sha, branch) ||
    runInfo.event !== "workflow_dispatch" ||
    runInfo.status !== "completed" ||
    runInfo.conclusion !== "success" ||
    runInfo.workflowName !== WORKFLOW_NAME
  ) {
    fail("repository-native proof is not a successful exact-SHA run");
  }
  if (!Array.isArray(runInfo.jobs) || runInfo.jobs.some((job) => job?.conclusion !== "success")) {
    fail("repository-native proof contains a missing or unsuccessful job");
  }
}

function waitForRun(runId, sha, branch, trustedWorkflowRef, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const runInfo = readRun(runId);
    if (runInfo.status === "completed") {
      assertSuccessfulRun(runInfo, sha, branch, trustedWorkflowRef);
      return runInfo;
    }
    if (Date.now() >= deadline) {
      fail("repository-native proof timed out");
    }
    const wait = spawnSync("sleep", [String(Math.max(1, Math.ceil(pollMs / 1000)))], {
      stdio: "ignore",
    });
    if (wait.error || wait.status !== 0) {
      fail("repository-native proof polling was interrupted");
    }
  }
}

function runProof({ source, sha, branch, receiptPath }) {
  const sourceRoot = validateIdentity({ source, sha, branch });
  const trustedWorkflowRef = readTrustedWorkflowRef();
  run("git", ["push", REMOTE_URL, `${sha}:refs/heads/${branch}`], {
    cwd: sourceRoot,
    timeoutMs: 15 * 60 * 1000,
  });
  const remoteLine = run("git", ["ls-remote", REMOTE_URL, `refs/heads/${branch}`], {
    cwd: sourceRoot,
  });
  if (remoteLine.split(/\s+/u)[0] !== sha) {
    fail("published branch does not resolve to the exact candidate SHA");
  }
  const dispatchedAtMs = Date.now();
  run("gh", [
    "workflow",
    "run",
    WORKFLOW,
    "--repo",
    REPOSITORY,
    "--ref",
    trustedWorkflowRef,
    "--field",
    `candidate_sha=${sha}`,
    "--field",
    `candidate_branch=${branch}`,
  ]);
  let runInfo;
  const discoveryDeadline = Date.now() + 2 * 60 * 1000;
  for (;;) {
    const runs = parseRuns(
      run("gh", [
        "run",
        "list",
        "--repo",
        REPOSITORY,
        "--workflow",
        WORKFLOW,
        "--branch",
        trustedWorkflowRef,
        "--event",
        "workflow_dispatch",
        "--limit",
        "10",
        "--json",
        "databaseId,headBranch,headSha,status,conclusion,url,workflowName,displayTitle,event,createdAt",
      ]),
    );
    try {
      runInfo = exactRun(runs, sha, branch, trustedWorkflowRef, dispatchedAtMs);
      break;
    } catch (error) {
      if (Date.now() >= discoveryDeadline) {
        throw error;
      }
      spawnSync("sleep", ["5"], { stdio: "ignore" });
    }
  }
  const completed = waitForRun(runInfo.databaseId, sha, branch, trustedWorkflowRef);
  const receipt = {
    schema: RECEIPT_SCHEMA,
    repository: REPOSITORY,
    workflow: WORKFLOW,
    trustedWorkflowRef,
    trustedWorkflowSha: completed.headSha,
    branch,
    sourceSha: sha,
    runId: completed.databaseId,
    runUrl: completed.url,
    createdAt: completed.createdAt,
    completedAt: completed.updatedAt,
    result: "passed",
  };
  writeAtomic(receiptPath, receipt);
  return {
    ...receipt,
    receiptPath: path.resolve(receiptPath),
    receiptSha256: sha256File(receiptPath),
  };
}

function verifyProof({ receiptPath, expectedSha }) {
  const resolved = path.resolve(receiptPath);
  const info = fs.lstatSync(resolved);
  if (!info.isFile() || info.isSymbolicLink() || info.mode & 0o077) {
    fail("GitHub proof receipt is missing or not private");
  }
  const receipt = JSON.parse(fs.readFileSync(resolved, "utf8"));
  if (
    !isRecord(receipt) ||
    receipt.schema !== RECEIPT_SCHEMA ||
    receipt.repository !== REPOSITORY ||
    receipt.workflow !== WORKFLOW ||
    receipt.sourceSha !== expectedSha ||
    receipt.result !== "passed" ||
    typeof receipt.trustedWorkflowRef !== "string" ||
    typeof receipt.trustedWorkflowSha !== "string" ||
    !SHA_PATTERN.test(receipt.trustedWorkflowSha) ||
    !BRANCH_PATTERN.test(String(receipt.branch ?? "")) ||
    !Number.isSafeInteger(receipt.runId)
  ) {
    fail("GitHub proof receipt is invalid or bound to another candidate");
  }
  const trustedWorkflowRef = validateTrustedWorkflowRef(receipt.trustedWorkflowRef);
  const completedAt = Date.parse(String(receipt.completedAt ?? ""));
  if (
    !Number.isFinite(completedAt) ||
    Date.now() - completedAt > MAX_RECEIPT_AGE_MS ||
    completedAt > Date.now() + 60_000
  ) {
    fail("GitHub proof receipt is stale or future-dated");
  }
  const runInfo = readRun(receipt.runId);
  assertSuccessfulRun(runInfo, expectedSha, receipt.branch, trustedWorkflowRef);
  if (runInfo.headSha !== receipt.trustedWorkflowSha) {
    fail("trusted workflow identity changed after proof");
  }
  return { result: "verified", receiptPath: resolved, sourceSha: expectedSha };
}

function isMainModule() {
  return Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
}

if (isMainModule()) {
  try {
    const { command, values } = parseOptions(process.argv.slice(2));
    const result =
      command === "run"
        ? runProof({
            source: values.get("source") || "",
            sha: values.get("sha") || "",
            branch: values.get("branch") || "",
            receiptPath: values.get("receipt") || "",
          })
        : command === "verify"
          ? verifyProof({
              receiptPath: values.get("receipt") || "",
              expectedSha: values.get("expected-sha") || "",
            })
          : fail("command must be run or verify");
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

export { assertSuccessfulRun, exactRun, validateIdentity };

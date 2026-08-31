#!/usr/bin/env node
// Publish one prepared candidate to the private SnowBelt fork and bind the
// repository-native exact-SHA proof to a locally verifiable receipt.
// Dispatch the trusted default-branch CI workflow rather than a workflow from
// the candidate branch, then verify its target checkout before accepting it.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const RECEIPT_SCHEMA = "openclaw.custom-runtime-github-proof.v1";
const REPOSITORY = "SnowBelt/openclaw";
const REMOTE_URL = "https://github.com/SnowBelt/openclaw.git";
const WORKFLOW = "ci.yml";
const WORKFLOW_NAME = "CI";
const REQUIRED_WORKFLOW_JOBS = new Set(["preflight"]);
const NON_PROOF_WORKFLOW_JOBS = new Set([
  "runner-admission",
  ...REQUIRED_WORKFLOW_JOBS,
  "ci-timings-summary",
]);
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const BRANCH_PATTERN = /^codex\/runtime-update-[0-9]{8}T[0-9]{6}Z$/u;
const DEFAULT_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const DEFAULT_POLL_MS = 15_000;
const RUN_DISCOVERY_TIMEOUT_MS = 2 * 60 * 1000;
const RUN_DISCOVERY_POLL_MS = 5_000;
const MAX_RECEIPT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ANSI_ESCAPE = String.fromCharCode(0x1b);
const ANSI_CSI_PATTERN = new RegExp(`${ANSI_ESCAPE}\\[[0-?]*[ -/]*[@-~]`, "gu");

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
  if (run("git", ["rev-parse", "HEAD"], { cwd: sourceRoot }) !== sha) {
    fail("candidate source HEAD does not match the requested exact SHA");
  }
  if (run("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: sourceRoot })) {
    fail("candidate source is dirty");
  }
  return sourceRoot;
}

function parseDispatchedRunId(output) {
  const match = output
    .trim()
    .match(/^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/(\d+)\/?$/u);
  const runId = match ? Number(match[1]) : Number.NaN;
  if (!Number.isSafeInteger(runId)) {
    fail("GitHub workflow dispatch did not return a run URL");
  }
  return runId;
}

function readRun(runId) {
  const raw = run("gh", [
    "run",
    "view",
    String(runId),
    "--repo",
    REPOSITORY,
    "--json",
    "databaseId,headBranch,headSha,status,conclusion,url,workflowName,createdAt,updatedAt,jobs",
  ]);
  const value = JSON.parse(raw);
  if (!isRecord(value)) {
    fail("GitHub run detail is malformed");
  }
  return value;
}

function readJobLog(runId, jobId) {
  return run("gh", [
    "run",
    "view",
    String(runId),
    "--repo",
    REPOSITORY,
    "--job",
    String(jobId),
    "--log",
  ]);
}

function parseRunList(output) {
  const value = JSON.parse(output);
  if (!Array.isArray(value) || value.some((item) => !isRecord(item))) {
    fail("GitHub run listing is malformed");
  }
  return value;
}

function listWorkflowRuns(workflowRef) {
  return parseRunList(
    run("gh", [
      "run",
      "list",
      "--repo",
      REPOSITORY,
      "--workflow",
      WORKFLOW,
      "--branch",
      workflowRef,
      "--event",
      "workflow_dispatch",
      "--limit",
      "100",
      "--json",
      "databaseId,headBranch,headSha,status,conclusion,url,workflowName,createdAt,updatedAt",
    ]),
  );
}

function selectDispatchedRun(runs, { workflowRef, workflowSha, dispatchedAtMs, beforeRunIds }) {
  const matches = runs.filter((candidate) => {
    const createdAt = Date.parse(String(candidate.createdAt ?? ""));
    return (
      Number.isSafeInteger(candidate.databaseId) &&
      !beforeRunIds.has(String(candidate.databaseId)) &&
      candidate.headBranch === workflowRef &&
      candidate.headSha === workflowSha &&
      candidate.workflowName === WORKFLOW_NAME &&
      Number.isFinite(createdAt) &&
      createdAt >= dispatchedAtMs - 60_000
    );
  });
  if (matches.length > 1) {
    fail("GitHub run discovery found multiple ambiguous trusted workflow runs");
  }
  return matches[0] ?? null;
}

function discoverDispatchedRun(options) {
  const deadline = Date.now() + RUN_DISCOVERY_TIMEOUT_MS;
  for (;;) {
    const candidate = selectDispatchedRun(listWorkflowRuns(options.workflowRef), options);
    if (candidate) {
      return candidate;
    }
    if (Date.now() >= deadline) {
      fail("GitHub workflow dispatch did not expose a discoverable run");
    }
    const wait = spawnSync("sleep", [String(RUN_DISCOVERY_POLL_MS / 1000)], {
      stdio: "ignore",
    });
    if (wait.error || wait.status !== 0) {
      fail("GitHub workflow run discovery was interrupted");
    }
  }
}

function preflightJobId(runInfo) {
  if (!Array.isArray(runInfo.jobs)) {
    fail("repository-native proof contains no jobs");
  }
  const job = runInfo.jobs.find(
    (candidate) => candidate?.name === "preflight" && Number.isSafeInteger(candidate?.databaseId),
  );
  if (!job) {
    fail("repository-native proof has no preflight job id");
  }
  return job.databaseId;
}

function assertExactTargetCheckoutLog(log, sha) {
  const normalized = String(log).replaceAll(ANSI_CSI_PATTERN, "");
  if (/target_ref .* unavailable; falling back to head SHA/iu.test(normalized)) {
    fail("trusted workflow fell back from the requested candidate target");
  }
  const fetchedExactSha = normalized.split(/\r?\n/u).some((line) => {
    return line.includes(` ${sha} -> origin/checkout`) || line.includes(`HEAD is now at ${sha}`);
  });
  if (!fetchedExactSha) {
    fail("trusted workflow log does not prove the exact candidate checkout");
  }
}

function assertSuccessfulRun(runInfo, workflowSha, workflowRef) {
  if (
    runInfo.headSha !== workflowSha ||
    runInfo.headBranch !== workflowRef ||
    runInfo.status !== "completed" ||
    runInfo.conclusion !== "success" ||
    runInfo.workflowName !== WORKFLOW_NAME
  ) {
    fail("repository-native proof is not a successful trusted workflow run");
  }
  if (!Array.isArray(runInfo.jobs) || runInfo.jobs.length === 0) {
    fail("repository-native proof contains no jobs");
  }
  const jobsByName = new Map(runInfo.jobs.map((job) => [job?.name, job]));
  for (const requiredJob of REQUIRED_WORKFLOW_JOBS) {
    if (jobsByName.get(requiredJob)?.conclusion !== "success") {
      fail(`repository-native proof required job ${requiredJob} did not pass`);
    }
  }
  if (runInfo.jobs.some((job) => job?.conclusion !== "success" && job?.conclusion !== "skipped")) {
    fail("repository-native proof contains an unsuccessful job");
  }
  if (
    !runInfo.jobs.some(
      (job) => job?.conclusion === "success" && !NON_PROOF_WORKFLOW_JOBS.has(job.name),
    )
  ) {
    fail("repository-native proof contains no substantive passing job");
  }
}

function assertPublishedBranch(remoteLine, sha, branch) {
  const lines = remoteLine.trim().split("\n").filter(Boolean);
  const fields = lines.length === 1 ? lines[0].trim().split(/\s+/u) : [];
  if (fields.length !== 2 || fields[0] !== sha || fields[1] !== `refs/heads/${branch}`) {
    fail("published branch does not resolve to the exact candidate SHA");
  }
}

function waitForRun(runId, workflowSha, workflowRef, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const runInfo = readRun(runId);
    if (runInfo.status === "completed") {
      assertSuccessfulRun(runInfo, workflowSha, workflowRef);
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
  run("git", ["push", REMOTE_URL, `${sha}:refs/heads/${branch}`], {
    cwd: sourceRoot,
    timeoutMs: 15 * 60 * 1000,
  });
  const remoteLine = run("git", ["ls-remote", REMOTE_URL, `refs/heads/${branch}`], {
    cwd: sourceRoot,
  });
  assertPublishedBranch(remoteLine, sha, branch);
  const workflowRef = run("gh", ["api", `repos/${REPOSITORY}`, "--jq", ".default_branch"]);
  if (!/^[A-Za-z0-9._/-]+$/u.test(workflowRef)) {
    fail("repository default branch is invalid");
  }
  const workflowSha = run("gh", [
    "api",
    `repos/${REPOSITORY}/commits/${workflowRef}`,
    "--jq",
    ".sha",
  ]);
  if (!SHA_PATTERN.test(workflowSha)) {
    fail("repository default branch did not resolve to an exact workflow SHA");
  }
  const dispatchedAtMs = Date.now();
  const beforeRunIds = new Set(
    listWorkflowRuns(workflowRef)
      .filter((runInfo) => Number.isSafeInteger(runInfo.databaseId))
      .map((runInfo) => String(runInfo.databaseId)),
  );
  const dispatchOutput = run("gh", [
    "workflow",
    "run",
    WORKFLOW,
    "--repo",
    REPOSITORY,
    "--ref",
    workflowRef,
    "-f",
    `target_ref=${sha}`,
  ]);
  let runId;
  let dispatchResolution = "url";
  try {
    runId = parseDispatchedRunId(dispatchOutput);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("did not return a run URL")) {
      throw error;
    }
    dispatchResolution = "run-list";
    runId = discoverDispatchedRun({
      workflowRef,
      workflowSha,
      dispatchedAtMs,
      beforeRunIds,
    }).databaseId;
  }
  const dispatchedRun = readRun(runId);
  if (
    dispatchedRun.headBranch !== workflowRef ||
    dispatchedRun.workflowName !== WORKFLOW_NAME ||
    dispatchedRun.headSha !== workflowSha
  ) {
    fail("GitHub workflow dispatch did not create the expected trusted run");
  }
  const completed = waitForRun(runId, dispatchedRun.headSha, workflowRef);
  const targetCheckoutJobId = preflightJobId(completed);
  assertExactTargetCheckoutLog(readJobLog(runId, targetCheckoutJobId), sha);
  const receipt = {
    schema: RECEIPT_SCHEMA,
    repository: REPOSITORY,
    workflow: WORKFLOW,
    workflowRef,
    workflowSha: completed.headSha,
    branch,
    sourceSha: sha,
    targetRef: sha,
    targetCheckout: { jobId: targetCheckoutJobId, sha },
    dispatchResolution,
    runId,
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
    receipt.workflowRef === undefined ||
    receipt.workflowSha === undefined ||
    receipt.sourceSha !== expectedSha ||
    receipt.targetRef !== expectedSha ||
    receipt.result !== "passed" ||
    !BRANCH_PATTERN.test(String(receipt.branch ?? "")) ||
    !Number.isSafeInteger(receipt.runId) ||
    !["url", "run-list"].includes(receipt.dispatchResolution) ||
    !isRecord(receipt.targetCheckout) ||
    receipt.targetCheckout.sha !== expectedSha ||
    !Number.isSafeInteger(receipt.targetCheckout.jobId)
  ) {
    fail("GitHub proof receipt is invalid or bound to another candidate");
  }
  if (
    typeof receipt.workflowRef !== "string" ||
    !/^[A-Za-z0-9._/-]+$/u.test(receipt.workflowRef) ||
    typeof receipt.workflowSha !== "string" ||
    !SHA_PATTERN.test(receipt.workflowSha)
  ) {
    fail("GitHub proof receipt is missing trusted workflow identity");
  }
  const completedAt = Date.parse(String(receipt.completedAt ?? ""));
  if (
    !Number.isFinite(completedAt) ||
    Date.now() - completedAt > MAX_RECEIPT_AGE_MS ||
    completedAt > Date.now() + 60_000
  ) {
    fail("GitHub proof receipt is stale or future-dated");
  }
  assertPublishedBranch(
    run("git", ["ls-remote", REMOTE_URL, `refs/heads/${receipt.branch}`]),
    expectedSha,
    receipt.branch,
  );
  const runInfo = readRun(receipt.runId);
  assertSuccessfulRun(runInfo, receipt.workflowSha, receipt.workflowRef);
  assertExactTargetCheckoutLog(
    readJobLog(receipt.runId, receipt.targetCheckout.jobId),
    expectedSha,
  );
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

export {
  parseDispatchedRunId,
  assertPublishedBranch,
  assertSuccessfulRun,
  assertExactTargetCheckoutLog,
  selectDispatchedRun,
};

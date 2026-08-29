#!/usr/bin/env node
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const safePath =
  process.platform === "win32"
    ? (process.env.PATH ?? "")
    : "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";

function fail(message) {
  process.stderr.write(`Local AI Assist verifier: ${message}\n`);
  process.exit(1);
}

function run(command, argv, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argv, {
      cwd: options.cwd,
      env: options.env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    const timer = setTimeout(() => {
      try {
        process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGTERM");
      } catch {}
      setTimeout(() => {
        try {
          process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGKILL");
        } catch {}
      }, 2_000).unref();
    }, options.timeoutMs ?? 60_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
  });
}

async function git(args, options = {}) {
  const result = await run("git", args, {
    cwd: process.cwd(),
    timeoutMs: options.timeoutMs ?? 60_000,
    env: { PATH: safePath, LANG: "C.UTF-8", GIT_CONFIG_NOSYSTEM: "1" },
  });
  if (result.code !== 0) {
    fail(`git ${args[0]} failed: ${result.stderr.toString("utf8").slice(-2000)}`);
  }
  return result.stdout;
}

function within(allowed, candidate) {
  return candidate === allowed || candidate.startsWith(`${allowed}/`);
}

function safeRelative(raw) {
  const normalized = path.posix.normalize(raw.replaceAll("\\", "/"));
  return (
    raw.length > 0 &&
    !path.isAbsolute(raw) &&
    normalized !== "." &&
    normalized !== ".." &&
    !normalized.startsWith("../") &&
    normalized !== ".git" &&
    !normalized.startsWith(".git/") &&
    normalized !== ".local-ai-assist" &&
    !normalized.startsWith(".local-ai-assist/")
  );
}

if (process.argv.length !== 3) {
  fail("verifier accepts exactly one opaque contract id");
}
const contractId = process.argv[2] ?? "";
if (!/^[a-f0-9-]{36}$/u.test(contractId)) {
  fail("missing or invalid opaque contract id");
}
const verifierRoot = process.env.LOCAL_AI_ASSIST_VERIFIER_ROOT;
if (typeof verifierRoot !== "string" || !path.isAbsolute(verifierRoot)) {
  fail("locked verifier contract root is unavailable");
}
const contractPath = path.resolve(verifierRoot, `${contractId}.verify.json`);
const relativeContract = path.relative(path.resolve(verifierRoot), contractPath);
if (!relativeContract || relativeContract.startsWith("..") || path.isAbsolute(relativeContract)) {
  fail("locked verifier contract escaped its root");
}
const contractStat = await fs.lstat(contractPath);
if (!contractStat.isFile() || contractStat.isSymbolicLink() || (contractStat.mode & 0o077) !== 0) {
  fail("verifier contract must be a private regular file");
}
const contract = JSON.parse(await fs.readFile(contractPath, "utf8"));
if (
  contract.schemaVersion !== 1 ||
  contract.contractId !== contractId ||
  !Array.isArray(contract.checkArgv) ||
  contract.checkArgv.length === 0 ||
  !Array.isArray(contract.allowedPaths) ||
  contract.allowedPaths.length === 0 ||
  !Array.isArray(contract.expectedOutputs) ||
  contract.expectedOutputs.length === 0 ||
  !contract.expectedOutputs.every((item) => typeof item === "string" && safeRelative(item))
) {
  fail("invalid verifier contract");
}
if (
  typeof contract.expectedTaskdir !== "string" ||
  !path.isAbsolute(contract.expectedTaskdir) ||
  typeof contract.expectedGitCommonDir !== "string" ||
  !path.isAbsolute(contract.expectedGitCommonDir) ||
  typeof contract.workerReceiptPath !== "string" ||
  !path.isAbsolute(contract.workerReceiptPath)
) {
  fail("verifier contract is missing immutable Git identity");
}
if (!path.isAbsolute(contract.artifactOutputDir)) {
  fail("artifact output directory must be absolute");
}
const taskdir = await fs.realpath(process.cwd());
const expectedTaskdir = await fs.realpath(contract.expectedTaskdir);
if (taskdir !== expectedTaskdir) {
  fail("verifier task directory drifted from the locked contract");
}
const gitEntry = path.join(taskdir, ".git");
const gitEntryStat = await fs.lstat(gitEntry);
if ((!gitEntryStat.isFile() && !gitEntryStat.isDirectory()) || gitEntryStat.isSymbolicLink()) {
  fail("worktree .git metadata is missing or unsafe");
}
const gitCommonDir = await fs.realpath(
  path.resolve(taskdir, (await git(["rev-parse", "--git-common-dir"])).toString("utf8").trim()),
);
const expectedGitCommonDir = await fs.realpath(contract.expectedGitCommonDir);
if (gitCommonDir !== expectedGitCommonDir) {
  fail("worktree .git metadata points outside the locked snapshot");
}
const startedAt = new Date();
const check = await run(contract.checkArgv[0], contract.checkArgv.slice(1), {
  cwd: taskdir,
  timeoutMs: contract.checkTimeoutMs,
  env: {
    PATH: safePath,
    TMPDIR: process.env.TMPDIR ?? "/tmp",
    LANG: "C.UTF-8",
    CI: "1",
    NO_COLOR: "1",
  },
});
const checkLog = Buffer.concat([
  Buffer.from(
    `argv=${JSON.stringify(contract.checkArgv)}\nexit=${String(check.code)} signal=${String(check.signal)}\n`,
  ),
  Buffer.from("--- stdout ---\n"),
  check.stdout,
  Buffer.from("\n--- stderr ---\n"),
  check.stderr,
]);
if (check.code !== 0) {
  process.stderr.write(checkLog.subarray(Math.max(0, checkLog.length - 8_000)));
  fail(`declared check failed with exit ${String(check.code)}`);
}

const untracked = (await git(["ls-files", "--others", "--exclude-standard", "-z"]))
  .toString("utf8")
  .split("\0")
  .filter(
    (item) =>
      item && item !== contract.artifactDirName && !item.startsWith(`${contract.artifactDirName}/`),
  );
if (untracked.length > 0) {
  await git(["add", "-N", "--", ...untracked]);
}
const changed = [
  ...new Set(
    (await git(["diff", "--name-only", "--diff-filter=ACDMRTUXB", "-z", "HEAD", "--"]))
      .toString("utf8")
      .split("\0")
      .filter(
        (item) =>
          item &&
          item !== contract.artifactDirName &&
          !item.startsWith(`${contract.artifactDirName}/`),
      ),
  ),
].toSorted((left, right) => left.localeCompare(right));
const workerPath = path.resolve(contract.workerReceiptPath);
let worker;
try {
  const workerStat = await fs.lstat(workerPath);
  if (!workerStat.isFile() || workerStat.isSymbolicLink() || (workerStat.mode & 0o077) !== 0) {
    fail("trusted worker identity receipt is not a private regular file");
  }
  worker = JSON.parse(await fs.readFile(workerPath, "utf8"));
} catch {
  if (changed.length === 0) {
    process.stdout.write(`Local AI Assist baseline check passed for ${contract.taskKey}.\n`);
    process.exit(0);
  }
  fail("trusted worker identity receipt is missing or invalid");
}
if (contract.mustChange && changed.length === 0) {
  fail("task declared must_change=true but produced no repository change");
}
for (const relativePath of changed) {
  if (!safeRelative(relativePath)) {
    fail(`unsafe changed path: ${relativePath}`);
  }
  if (!contract.allowedPaths.some((allowed) => within(allowed, relativePath))) {
    fail(`changed path is outside allowed_paths: ${relativePath}`);
  }
  if (!contract.expectedOutputs.includes(relativePath)) {
    fail(`unexpected changed output: ${relativePath}`);
  }
  const absolute = path.join(taskdir, relativePath);
  try {
    const stat = await fs.lstat(absolute);
    const indexEntry = (await git(["ls-files", "-s", "--", relativePath])).toString("utf8");
    const isSymlink = stat.isSymbolicLink() || indexEntry.startsWith("120000 ");
    if (isSymlink) {
      const linkTarget = await fs.readlink(absolute);
      const target = path.resolve(path.dirname(absolute), linkTarget);
      const relativeTarget = path.relative(taskdir, target);
      if (
        relativeTarget === ".." ||
        relativeTarget.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativeTarget)
      ) {
        fail(`changed symlink escapes the worktree: ${relativePath}`);
      }
    }
    if (!stat.isFile() && !isSymlink) {
      fail(`changed output is not a regular file: ${relativePath}`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}
for (const expected of contract.expectedOutputs) {
  if (!safeRelative(expected)) {
    fail(`unsafe expected output path: ${expected}`);
  }
  try {
    const stat = await fs.lstat(path.join(taskdir, expected));
    if (!stat.isFile() || stat.isSymbolicLink()) {
      fail(`expected output is not a regular file: ${expected}`);
    }
  } catch {
    fail(`expected output is missing: ${expected}`);
  }
}
const numstat = (await git(["diff", "--numstat", "HEAD", "--"])).toString("utf8");
if (numstat.split("\n").some((line) => line.startsWith("-\t-\t"))) {
  fail("binary changes are forbidden");
}
const patchBytes = await git(["diff", "--binary", "--full-index", "HEAD", "--"]);
if (patchBytes.byteLength > contract.maxPatchBytes) {
  fail(`patch exceeds ${contract.maxPatchBytes} bytes`);
}
if (
  worker.schemaVersion !== 1 ||
  worker.taskKey !== contract.taskKey ||
  worker.model !== contract.expectedModel ||
  !worker.model.startsWith("ollama/") ||
  !Number.isInteger(worker.sessionAttempts) ||
  worker.sessionAttempts < 1 ||
  worker.sessionAttempts > 2 ||
  !Number.isInteger(worker.modelCompletions) ||
  worker.modelCompletions < 1 ||
  !Number.isInteger(worker.sessionRetries) ||
  worker.sessionRetries !== worker.sessionAttempts - 1 ||
  !/^[a-f0-9]{64}$/u.test(worker.trajectorySha256)
) {
  fail("trusted worker identity receipt or inference telemetry does not match the task");
}
const artifactDir = path.resolve(contract.artifactOutputDir);
await fs.mkdir(artifactDir, { recursive: true, mode: 0o700 });
const receipt = {
  schemaVersion: 1,
  taskKey: contract.taskKey,
  status: "pass",
  model: worker.model,
  sessionAttempts: worker.sessionAttempts,
  modelCompletions: worker.modelCompletions,
  sessionRetries: worker.sessionRetries,
  trajectorySha256: worker.trajectorySha256,
  changedFiles: changed,
  patchSha256: crypto.createHash("sha256").update(patchBytes).digest("hex"),
  checkSha256: crypto.createHash("sha256").update(checkLog).digest("hex"),
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
};
await fs.writeFile(path.join(artifactDir, "changes.patch"), patchBytes, { mode: 0o600 });
await fs.writeFile(
  path.join(artifactDir, "changed-files.json"),
  `${JSON.stringify(changed, null, 2)}\n`,
  { mode: 0o600 },
);
await fs.writeFile(path.join(artifactDir, "check.log"), checkLog, { mode: 0o600 });
await fs.writeFile(
  path.join(artifactDir, "receipt.json"),
  `${JSON.stringify(receipt, null, 2)}\n`,
  { mode: 0o600 },
);
for (const name of ["changes.patch", "changed-files.json", "check.log", "receipt.json"]) {
  await fs.chmod(path.join(artifactDir, name), 0o600);
}
process.stdout.write(
  `Local AI Assist verifier accepted ${contract.taskKey}: ${changed.length} changed file(s).\n`,
);

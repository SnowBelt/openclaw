// SAFETY-RATCHET: template-aware
// SAFETY-RATCHET: template-aware
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { isRecord } from "openclaw/plugin-sdk/string-coerce-runtime";
import { sha256Bytes, stableStringify } from "./crypto.js";
import { runCommand, SAFE_EXEC_PATH } from "./process.js";
import {
  RINGER_SCHEMA_VERSION,
  type ResolvedRingerConfig,
  type RingerAdapterManifest,
  type RingerRepositoryPolicy,
  type RingerSnapshotReceipt,
  type RingerTaskManifest,
} from "./types.js";

const ROOT_KEYS = new Set([
  "schema_version",
  "run_name",
  "repo",
  "snapshot_id",
  "source_sha",
  "source_digest",
  "check_digest",
  "environment_digest",
  "workdir",
  "worktrees",
  "max_parallel",
  "tasks",
]);
const SHA256 = /^[a-f0-9]{64}$/u;
const TASK_KEYS = new Set([
  "key",
  "spec",
  "engine",
  "model",
  "task_type",
  "allowed_paths",
  "expected_outputs",
  "check_argv",
  "baseline_expect",
  "must_change",
  "verified",
  "timeout_s",
  "max_attempts",
  "full_access",
  "redact_spec",
]);
const SHELL_SYNTAX = /[\n\r;&|`$<>]/u;
const WINDOWS_ABSOLUTE = /^(?:[A-Za-z]:[\\/]|\\\\)/u;
const RELATIVE_ESCAPE = /(?:^|[\\/])\.\.(?:[\\/]|$)/u;
const FORBIDDEN_CHECK_WORDS = new Set([
  "add",
  "curl",
  "deploy",
  "install",
  "login",
  "publish",
  "push",
  "release",
  "rm",
  "scp",
  "ssh",
  "upgrade",
  "wget",
]);
const SENSITIVE_SPEC =
  /(?:BEGIN [A-Z ]*PRIVATE KEY|(?:api[_-]?key|secret|token|password)\s*[:=]\s*["'][^"']{8,})/iu;
const SENSITIVE_ARGUMENT =
  /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|^(?:--?[A-Za-z0-9_-]*?(?:api[_-]?key|credential|secret|token|password|authorization|bearer|cookie|private[_-]?key)[A-Za-z0-9_-]*|(?:api[_-]?key|credential|secret|token|password|authorization|bearer|cookie|private[_-]?key))[=:]?\s*\S*)/iu;

function assertExactKeys(
  record: Record<string, unknown>,
  allowed: Set<string>,
  label: string,
): void {
  const unknown = Object.keys(record).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`${label} contains unknown field(s): ${unknown.toSorted().join(", ")}.`);
  }
}

function requiredString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label}.${key} must be a non-empty string.`);
  }
  return value.trim();
}

function requiredStringArray(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string[] {
  const value = record[key];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((item) => typeof item === "string" && item.trim())
  ) {
    throw new Error(`${label}.${key} must be a non-empty array of strings.`);
  }
  // SAFETY: The every() guard above proves every array member is a string.
  return value.map((item) => (item as string).trim());
}

function normalizeRelativePath(raw: string, label: string): string {
  if (path.isAbsolute(raw) || WINDOWS_ABSOLUTE.test(raw) || raw.includes("\0")) {
    throw new Error(`${label} must be repository-relative.`);
  }
  const normalized = path.posix.normalize(raw.replaceAll("\\", "/"));
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized === ".git" ||
    normalized.startsWith(".git/") ||
    normalized === ".local-ai-assist" ||
    normalized.startsWith(".local-ai-assist/")
  ) {
    throw new Error(`${label} escapes the repository or targets a reserved adapter path.`);
  }
  return normalized.replace(/\/$/u, "");
}

function pathContains(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}/`);
}

function pathIdentity(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase("en-US");
}

function pathsOverlap(left: string, right: string): boolean {
  const leftIdentity = pathIdentity(left);
  const rightIdentity = pathIdentity(right);
  return (
    pathContains(left, right) ||
    pathContains(right, left) ||
    pathContains(leftIdentity, rightIdentity) ||
    pathContains(rightIdentity, leftIdentity)
  );
}

export function computeManifestCheckDigest(tasks: readonly RingerTaskManifest[]): string {
  return sha256Bytes(
    stableStringify(
      tasks
        .map((task) => ({
          key: task.key,
          spec: task.spec,
          engine: task.engine,
          model: task.model,
          task_type: task.task_type,
          allowed_paths: task.allowed_paths,
          expected_outputs: task.expected_outputs,
          check_argv: task.check_argv,
          baseline_expect: task.baseline_expect,
          must_change: task.must_change,
          verified: task.verified,
          timeout_s: task.timeout_s,
          max_attempts: task.max_attempts,
          full_access: task.full_access,
          redact_spec: task.redact_spec,
        }))
        .toSorted((left, right) => left.key.localeCompare(right.key)),
    ),
  );
}

async function assertWithinStateDir(stateDir: string, candidate: string): Promise<string> {
  const resolved = path.resolve(candidate);
  const resolvedStateDir = path.resolve(stateDir);
  const relative = path.relative(resolvedStateDir, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      "Manifest workdir must be a dedicated child of the configured Ringer stateDir.",
    );
  }
  const stateDirStat = await fs.lstat(resolvedStateDir);
  if (stateDirStat.isSymbolicLink() || !stateDirStat.isDirectory()) {
    throw new Error("Configured Ringer stateDir must be a real directory.");
  }
  let current = resolvedStateDir;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) {
        throw new Error("Manifest workdir cannot traverse a symbolic link.");
      }
      if (!stat.isDirectory()) {
        throw new Error("Manifest workdir path components must be directories.");
      }
    } catch (error) {
      // SAFETY: Node filesystem errors expose the documented errno code property.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        break;
      }
      throw error;
    }
  }
  return resolved;
}

function checkPrefixAllowed(argv: string[], policy: RingerRepositoryPolicy): boolean {
  return policy.checkArgvPrefixes.some(
    (prefix) => prefix.length <= argv.length && prefix.every((part, index) => argv[index] === part),
  );
}

function validateTask(
  raw: unknown,
  index: number,
  policy: RingerRepositoryPolicy,
): RingerTaskManifest {
  if (!isRecord(raw)) {
    throw new Error(`tasks[${index}] must be an object.`);
  }
  const label = `tasks[${index}]`;
  assertExactKeys(raw, TASK_KEYS, label);
  const key = requiredString(raw, "key", label);
  if (!/^[a-z0-9][a-z0-9_-]{0,47}$/u.test(key) || key === "logs") {
    throw new Error(`${label}.key must be a safe lowercase task key and cannot be "logs".`);
  }
  const spec = requiredString(raw, "spec", label);
  if (spec.length > 32_000) {
    throw new Error(`${label}.spec exceeds 32,000 characters.`);
  }
  if (SENSITIVE_SPEC.test(spec)) {
    throw new Error(`${label}.spec appears to contain a credential or private key.`);
  }
  if (raw.engine !== "openclaw-local") {
    throw new Error(`${label}.engine must be "openclaw-local".`);
  }
  const model = requiredString(raw, "model", label);
  const taskType = requiredString(raw, "task_type", label);
  const modelPolicy = policy.models.find((candidate) => candidate.ref === model);
  if (!modelPolicy) {
    throw new Error(`${label}.model is not allowlisted for this repository: ${model}`);
  }
  if (!modelPolicy.roles.some((role) => role === taskType)) {
    throw new Error(`${label}.model is not qualified for task type ${taskType}.`);
  }
  const allowedPaths = [
    ...new Set(
      requiredStringArray(raw, "allowed_paths", label).map((item) =>
        normalizeRelativePath(item, `${label}.allowed_paths`),
      ),
    ),
  ].toSorted();
  for (let left = 0; left < allowedPaths.length; left += 1) {
    for (let right = left + 1; right < allowedPaths.length; right += 1) {
      const leftPath = allowedPaths[left];
      const rightPath = allowedPaths[right];
      if (leftPath && rightPath && pathsOverlap(leftPath, rightPath)) {
        throw new Error(`${label}.allowed_paths contains redundant overlap.`);
      }
    }
  }
  const expectedOutputs = [
    ...new Set(
      requiredStringArray(raw, "expected_outputs", label).map((item) =>
        normalizeRelativePath(item, `${label}.expected_outputs`),
      ),
    ),
  ].toSorted();
  for (let left = 0; left < expectedOutputs.length; left += 1) {
    for (let right = left + 1; right < expectedOutputs.length; right += 1) {
      const leftPath = expectedOutputs[left];
      const rightPath = expectedOutputs[right];
      if (leftPath && rightPath && pathsOverlap(leftPath, rightPath)) {
        throw new Error(`${label}.expected_outputs contains overlapping paths.`);
      }
    }
  }
  for (const output of expectedOutputs) {
    if (!allowedPaths.some((allowed) => pathContains(allowed, output))) {
      throw new Error(`${label}.expected_outputs path is outside allowed_paths: ${output}`);
    }
  }
  const checkArgv = requiredStringArray(raw, "check_argv", label);
  if (checkArgv.some((part) => SHELL_SYNTAX.test(part))) {
    throw new Error(`${label}.check_argv contains forbidden shell syntax.`);
  }
  if (checkArgv.some((part) => SENSITIVE_ARGUMENT.test(part.trim()))) {
    throw new Error(`${label}.check_argv appears to contain a credential or private key.`);
  }
  if (
    checkArgv.slice(1).some((part) => path.isAbsolute(part) || RELATIVE_ESCAPE.test(part)) ||
    checkArgv.some((part) => FORBIDDEN_CHECK_WORDS.has(part.toLowerCase()))
  ) {
    throw new Error(
      `${label}.check_argv contains an absolute escape or forbidden side-effect command.`,
    );
  }
  if (!checkPrefixAllowed(checkArgv, policy)) {
    throw new Error(`${label}.check_argv does not match an allowlisted command prefix.`);
  }
  const baselineExpect = raw.baseline_expect;
  if (baselineExpect !== "pass" && baselineExpect !== "fail") {
    throw new Error(`${label}.baseline_expect must be "pass" or "fail".`);
  }
  if (raw.must_change !== true && raw.must_change !== false) {
    throw new Error(`${label}.must_change must be a boolean.`);
  }
  const verified = requiredString(raw, "verified", label);
  if (verified.length > 8_000 || SENSITIVE_SPEC.test(verified)) {
    throw new Error(`${label}.verified appears to contain unsafe or sensitive text.`);
  }
  const timeout = raw.timeout_s;
  if (typeof timeout !== "number" || !Number.isInteger(timeout) || timeout < 30 || timeout > 1800) {
    throw new Error(`${label}.timeout_s must be an integer from 30 through 1800.`);
  }
  if (raw.max_attempts !== 1 && raw.max_attempts !== 2) {
    throw new Error(`${label}.max_attempts must be 1 or 2.`);
  }
  if (raw.full_access !== false) {
    throw new Error(`${label}.full_access must be false.`);
  }
  if (raw.redact_spec !== true && raw.redact_spec !== false) {
    throw new Error(`${label}.redact_spec must be a boolean.`);
  }
  return {
    key,
    spec,
    engine: "openclaw-local",
    model,
    // SAFETY: taskType was matched against the closed task-type allowlist above.
    task_type: taskType as RingerTaskManifest["task_type"],
    allowed_paths: allowedPaths,
    expected_outputs: expectedOutputs,
    check_argv: checkArgv,
    baseline_expect: baselineExpect,
    must_change: raw.must_change,
    verified,
    timeout_s: timeout,
    max_attempts: raw.max_attempts,
    full_access: false,
    redact_spec: raw.redact_spec,
  };
}

export async function readAndValidateManifest(params: {
  config: ResolvedRingerConfig;
  manifestPath: string;
  expectedManifestSha256: string;
  snapshot: RingerSnapshotReceipt;
  policy: RingerRepositoryPolicy;
  expectedEnvironmentDigest?: string;
}): Promise<{ manifest: RingerAdapterManifest; manifestSha256: string }> {
  if (!path.isAbsolute(params.manifestPath)) {
    throw new Error("manifestPath must be absolute.");
  }
  const stat = await fs.lstat(params.manifestPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) {
    throw new Error("Manifest must be a regular non-symlink file no larger than 1 MiB.");
  }
  const bytes = await fs.readFile(params.manifestPath);
  const manifestSha256 = sha256Bytes(bytes);
  if (manifestSha256 !== params.expectedManifestSha256) {
    throw new Error(
      `Manifest digest mismatch: expected ${params.expectedManifestSha256}, found ${manifestSha256}.`,
    );
  }
  const raw: unknown = JSON.parse(bytes.toString("utf8"));
  if (!isRecord(raw)) {
    throw new Error("Manifest root must be an object.");
  }
  assertExactKeys(raw, ROOT_KEYS, "manifest");
  if (raw.schema_version !== RINGER_SCHEMA_VERSION) {
    throw new Error(`manifest.schema_version must be ${RINGER_SCHEMA_VERSION}.`);
  }
  const runName = requiredString(raw, "run_name", "manifest");
  if (!/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,79}$/u.test(runName)) {
    throw new Error("manifest.run_name contains unsupported characters or is too long.");
  }
  const repo = path.resolve(requiredString(raw, "repo", "manifest"));
  if (repo !== params.snapshot.repo) {
    throw new Error("manifest.repo does not match the prepared snapshot repository.");
  }
  if (raw.snapshot_id !== params.snapshot.snapshotId) {
    throw new Error("manifest.snapshot_id does not match the prepared snapshot.");
  }
  if (raw.source_sha !== params.snapshot.sourceSha) {
    throw new Error("manifest.source_sha does not match the immutable snapshot SHA.");
  }
  if (raw.source_digest !== params.snapshot.workspaceDigest) {
    throw new Error("manifest.source_digest does not match the snapshot content digest.");
  }
  if (typeof raw.check_digest !== "string" || !SHA256.test(raw.check_digest)) {
    throw new Error("manifest.check_digest must be an exact SHA-256 digest.");
  }
  if (typeof raw.environment_digest !== "string" || !SHA256.test(raw.environment_digest)) {
    throw new Error("manifest.environment_digest must be an exact SHA-256 digest.");
  }
  const workdir = await assertWithinStateDir(
    params.config.stateDir,
    requiredString(raw, "workdir", "manifest"),
  );
  if (raw.worktrees !== true) {
    throw new Error("manifest.worktrees must be true.");
  }
  const maxParallel = raw.max_parallel;
  if (
    typeof maxParallel !== "number" ||
    !Number.isInteger(maxParallel) ||
    maxParallel < 1 ||
    maxParallel > params.config.maxParallel
  ) {
    throw new Error(`manifest.max_parallel must be from 1 through ${params.config.maxParallel}.`);
  }
  if (
    !Array.isArray(raw.tasks) ||
    raw.tasks.length < 2 ||
    raw.tasks.length > params.config.maxTasks
  ) {
    throw new Error(`manifest.tasks must contain from 2 through ${params.config.maxTasks} tasks.`);
  }
  const tasks = raw.tasks.map((task, index) => validateTask(task, index, params.policy));
  const expectedCheckDigest = computeManifestCheckDigest(tasks);
  if (raw.check_digest !== expectedCheckDigest) {
    throw new Error(
      "manifest.check_digest does not match the canonical task verification contract.",
    );
  }
  if (
    params.expectedEnvironmentDigest !== undefined &&
    raw.environment_digest !== params.expectedEnvironmentDigest
  ) {
    throw new Error("manifest.environment_digest does not match the current execution pins.");
  }
  const keys = tasks.map((task) => task.key);
  if (new Set(keys).size !== keys.length) {
    throw new Error("Task keys must be unique.");
  }
  for (let left = 0; left < tasks.length; left += 1) {
    for (let right = left + 1; right < tasks.length; right += 1) {
      const leftTask = tasks[left];
      const rightTask = tasks[right];
      if (!leftTask || !rightTask) {
        continue;
      }
      for (const leftPath of leftTask.allowed_paths) {
        for (const rightPath of rightTask.allowed_paths) {
          if (pathsOverlap(leftPath, rightPath)) {
            throw new Error(
              `Tasks ${leftTask.key} and ${rightTask.key} have overlapping writable paths.`,
            );
          }
        }
      }
    }
  }
  return {
    manifest: {
      schema_version: RINGER_SCHEMA_VERSION,
      run_name: runName,
      repo,
      snapshot_id: params.snapshot.snapshotId,
      source_sha: params.snapshot.sourceSha,
      source_digest: params.snapshot.workspaceDigest,
      check_digest: raw.check_digest,
      environment_digest: raw.environment_digest,
      workdir,
      worktrees: true,
      max_parallel: maxParallel,
      tasks,
    },
    manifestSha256,
  };
}

function shellQuote(value: string): string {
  if (value.includes("\n") || value.includes("\r") || value.includes("\0")) {
    throw new Error("Generated verifier path contains forbidden control characters.");
  }
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function isNodeExecutable(command: string): boolean {
  const basename = path.basename(command).toLowerCase();
  return basename === "node" || basename === "nodejs";
}

function checkScriptPath(task: RingerTaskManifest): string | undefined {
  const [command, firstArgument, secondArgument, thirdArgument] = task.check_argv;
  if (!command) {
    return undefined;
  }
  if (isNodeExecutable(command)) {
    return firstArgument;
  }
  if (
    command.toLowerCase() === "pnpm" &&
    firstArgument?.toLowerCase() === "exec" &&
    secondArgument?.toLowerCase() === "tsx"
  ) {
    return thirdArgument;
  }
  return undefined;
}

async function assertCheckScriptInSnapshot(
  snapshot: RingerSnapshotReceipt,
  task: RingerTaskManifest,
): Promise<void> {
  const script = checkScriptPath(task);
  if (!script || script.startsWith("-")) {
    return;
  }
  const result = await runCommand(
    "git",
    ["-C", snapshot.shadowRepo, "cat-file", "-t", `${snapshot.sourceSha}:${script}`],
    {
      timeoutMs: 120_000,
      env: {
        PATH: SAFE_EXEC_PATH,
        LANG: "C",
        LC_ALL: "C",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_OPTIONAL_LOCKS: "0",
        GIT_TERMINAL_PROMPT: "0",
      },
    },
  );
  if (result.code !== 0 || result.stdout.toString("utf8").trim() !== "blob") {
    throw new Error(
      `Task ${task.key} check script is missing from the immutable snapshot: ${script}. Include the exact script in prepare --include-untracked before dispatch.`,
    );
  }
}

type VerifierTaskContract = {
  schemaVersion: 1;
  contractId: string;
  taskKey: string;
  expectedTaskdir: string;
  expectedGitCommonDir: string;
  workerReceiptPath: string;
  expectedModel: string;
  allowedPaths: string[];
  expectedOutputs: string[];
  checkArgv: string[];
  checkTimeoutMs: number;
  mustChange: boolean;
  maxPatchBytes: number;
  artifactDirName: ".local-ai-assist";
  artifactOutputDir: string;
};

type WorkerTaskContract = {
  schemaVersion: 1;
  taskKey: string;
  openclawCliPath: string;
  modelRef: string;
  contextWindow: number;
  maxTokens: number;
  timeoutMs: number;
  stateRoot: string;
  ollamaBaseUrl: string;
  dockerHost: string;
  dockerImage: string;
};

export async function materializeNativeManifest(params: {
  config: ResolvedRingerConfig;
  manifest: RingerAdapterManifest;
  snapshot: RingerSnapshotReceipt;
  policy: RingerRepositoryPolicy;
  preparationDir: string;
  workerScriptPath: string;
  verifierScriptPath: string;
  nodePath: string;
}): Promise<{ nativeManifestPath: string; taskArtifactRoots: Record<string, string> }> {
  const contractsDir = path.join(params.preparationDir, "contracts");
  const workdir = path.join(params.preparationDir, "worktrees");
  const verifiedArtifactsDir = path.join(params.preparationDir, "verified-artifacts");
  await fs.mkdir(contractsDir, { recursive: true, mode: 0o700 });
  await fs.mkdir(workdir, { recursive: true, mode: 0o700 });
  await fs.mkdir(verifiedArtifactsDir, { recursive: true, mode: 0o700 });
  const taskArtifactRoots: Record<string, string> = {};
  const tasks = [];
  for (const task of params.manifest.tasks) {
    await assertCheckScriptInSnapshot(params.snapshot, task);
    const model = params.policy.models.find((candidate) => candidate.ref === task.model);
    if (!model) {
      throw new Error(`Model policy disappeared while preparing ${task.key}.`);
    }
    const verifierId = crypto.randomUUID();
    const verifierContractPath = path.join(contractsDir, `${verifierId}.verify.json`);
    const workerContractPath = path.join(contractsDir, `${task.key}.worker.json`);
    const artifactOutputDir = path.join(verifiedArtifactsDir, task.key);
    const verifierContract: VerifierTaskContract = {
      schemaVersion: 1,
      contractId: verifierId,
      taskKey: task.key,
      expectedTaskdir: path.resolve(workdir, task.key),
      expectedGitCommonDir: path.join(params.snapshot.shadowRepo, ".git"),
      workerReceiptPath: path.join(params.preparationDir, "workers", task.key, "worker.json"),
      expectedModel: task.model,
      allowedPaths: task.allowed_paths,
      expectedOutputs: task.expected_outputs,
      checkArgv: task.check_argv,
      checkTimeoutMs: Math.min(task.timeout_s * 1000, 60_000),
      mustChange: task.must_change,
      maxPatchBytes: params.config.maxPatchBytes,
      artifactDirName: ".local-ai-assist",
      artifactOutputDir,
    };
    const workerContract: WorkerTaskContract = {
      schemaVersion: 1,
      taskKey: task.key,
      openclawCliPath: params.config.openclawCliPath!,
      modelRef: task.model,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      timeoutMs: task.timeout_s * 1000,
      stateRoot: path.join(params.preparationDir, "workers", task.key),
      ollamaBaseUrl: params.config.ollamaBaseUrl,
      dockerHost: params.config.dockerHost!,
      dockerImage: params.config.dockerImage,
    };
    const workerStateRoot = workerContract.stateRoot;
    await fs.mkdir(workerStateRoot, { recursive: true, mode: 0o700 });
    await fs.chmod(workerStateRoot, 0o700);
    await fs.rm(path.join(workerStateRoot, "worker.json"), { force: true });
    await fs.writeFile(verifierContractPath, `${JSON.stringify(verifierContract, null, 2)}\n`, {
      mode: 0o600,
    });
    await fs.writeFile(workerContractPath, `${JSON.stringify(workerContract, null, 2)}\n`, {
      mode: 0o600,
    });
    taskArtifactRoots[task.key] = artifactOutputDir;
    const verifierCommand = [
      shellQuote(params.nodePath),
      shellQuote(params.verifierScriptPath),
      shellQuote(verifierId),
    ].join(" ");
    tasks.push({
      key: task.key,
      spec: task.spec,
      engine: "openclaw-local",
      model: task.model,
      engine_args: ["--contract", workerContractPath],
      check: verifierCommand,
      expect_files: ["changes.patch", "changed-files.json", "check.log", "receipt.json"].map(
        (name) => path.join(artifactOutputDir, name),
      ),
      verified: task.verified,
      task_type: task.task_type,
      timeout_s: task.timeout_s,
      max_attempts: task.max_attempts,
      full_access: false,
      redact_spec: task.redact_spec,
    });
  }
  const nativeManifestPath = path.join(params.preparationDir, "ringer.native.json");
  await fs.writeFile(
    nativeManifestPath,
    `${JSON.stringify(
      {
        run_name: params.manifest.run_name,
        repo: params.snapshot.shadowRepo,
        workdir,
        worktrees: true,
        max_parallel: params.manifest.max_parallel,
        tasks,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  return { nativeManifestPath, taskArtifactRoots };
}

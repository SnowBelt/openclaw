// Detect an active immutable custom runtime so generic self-update paths fail closed.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const CUSTOM_RUNTIME_UPDATE_BROKER_REQUIRED_REASON = "custom-runtime-update-broker-required";

export type CustomRuntimeUpdatePolicy = {
  managedRuntime: boolean;
  standardUpdateBlocked: boolean;
  sourceDurable: boolean;
  sourceSha: string | null;
  sourceRepo: string | null;
  sourceBranch: string | null;
  runtimeRoot: string | null;
  pointerPath: string;
  reason: string;
};

export type CustomRuntimeUpdatePolicyOptions = {
  env?: NodeJS.ProcessEnv;
  homedir?: string;
  argv?: readonly string[];
  pointerPath?: string;
  durableSourceRoot?: string;
};

type RuntimePointer = {
  runtimeRoot: string;
  entrypoint: string;
  sourceSha: string;
  sourceRepo: string | null;
  sourceGitCommonDir: string | null;
  sourceBranch: string | null;
  sourceRemoteUrl: string | null;
  sourceRemoteRef: string | null;
  sourceRemoteSha: string | null;
  sourceRemoteVerifiedAt: string | null;
};

const LOCAL_GIT_PROVENANCE_CACHE_MS = 30_000;
const REMOTE_PROVENANCE_MAX_AGE_MS = 8 * 24 * 60 * 60 * 1_000;
let localGitProvenanceCache: { expiresAt: number; key: string; value: boolean } | undefined;

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readRuntimePointer(pointerPath: string): RuntimePointer | null {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(pointerPath, "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return null;
    }
    const record = raw as Record<string, unknown>;
    const runtimeRoot = nonEmptyString(record.runtimeRoot);
    const entrypoint = nonEmptyString(record.entrypoint);
    const sourceSha = nonEmptyString(record.sourceSha);
    if (!runtimeRoot || !entrypoint || !sourceSha) {
      return null;
    }
    const resolvedRoot = path.resolve(runtimeRoot);
    if (path.resolve(entrypoint) !== path.join(resolvedRoot, "dist", "index.js")) {
      return null;
    }
    return {
      runtimeRoot: resolvedRoot,
      entrypoint: path.resolve(entrypoint),
      sourceSha,
      sourceRepo: nonEmptyString(record.sourceRepo),
      sourceGitCommonDir: nonEmptyString(record.sourceGitCommonDir),
      sourceBranch: nonEmptyString(record.sourceBranch),
      sourceRemoteUrl: nonEmptyString(record.sourceRemoteUrl),
      sourceRemoteRef: nonEmptyString(record.sourceRemoteRef),
      sourceRemoteSha: nonEmptyString(record.sourceRemoteSha),
      sourceRemoteVerifiedAt: nonEmptyString(record.sourceRemoteVerifiedAt),
    };
  } catch {
    return null;
  }
}

function isSameOrChild(candidate: string, parent: string): boolean {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedParent = path.resolve(parent);
  return (
    resolvedCandidate === resolvedParent ||
    resolvedCandidate.startsWith(`${resolvedParent}${path.sep}`)
  );
}

function isCredentialFreeRemoteUrl(value: string | null): boolean {
  if (!value || value.includes("\r") || value.includes("\n") || value.includes("\0")) {
    return false;
  }
  if (path.isAbsolute(value)) {
    return true;
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//iu.test(value)) {
    return /^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9.-]+:[A-Za-z0-9._~/-]+$/u.test(value);
  }
  try {
    const parsed = new URL(value);
    const allowedScheme = ["file:", "git:", "https:", "ssh:"].includes(parsed.protocol);
    const usernameAllowed = parsed.protocol === "ssh:" || !parsed.username;
    return allowedScheme && usernameAllowed && !parsed.password && !parsed.search && !parsed.hash;
  } catch {
    return false;
  }
}

function isDurableRecoveryRef(value: string | null): boolean {
  return (
    value !== null &&
    (value.startsWith("refs/heads/") || value.startsWith("refs/tags/")) &&
    spawnSync("git", ["check-ref-format", value]).status === 0
  );
}

function isPersistentSourceRepo(sourceRepo: string | null, durableSourceRoot: string): boolean {
  if (!sourceRepo) {
    return false;
  }
  try {
    const sourceStat = fs.lstatSync(sourceRepo);
    if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
      return false;
    }
    const source = fs.realpathSync(sourceRepo);
    const root = fs.realpathSync(durableSourceRoot);
    return isSameOrChild(source, root);
  } catch {
    return false;
  }
}

function gitCommand(sourceRepo: string, args: readonly string[]): string | null {
  const result = spawnSync("git", ["-C", sourceRepo, ...args], {
    encoding: "utf8",
    timeout: 5_000,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function isValidLocalGitProvenance(pointer: RuntimePointer): boolean {
  const { sourceBranch, sourceGitCommonDir, sourceRepo, sourceSha } = pointer;
  if (!sourceBranch || !sourceGitCommonDir || !sourceRepo) {
    return false;
  }
  const cacheKey = [sourceRepo, sourceGitCommonDir, sourceBranch, sourceSha].join("\0");
  const now = Date.now();
  // PCC can poll this status frequently. Keep one short-lived identity result so the read-only
  // card does not spawn Git repeatedly; the update broker always performs fresh verification.
  if (localGitProvenanceCache?.key === cacheKey && localGitProvenanceCache.expiresAt >= now) {
    return localGitProvenanceCache.value;
  }
  const finish = (value: boolean): boolean => {
    localGitProvenanceCache = {
      expiresAt: now + LOCAL_GIT_PROVENANCE_CACHE_MS,
      key: cacheKey,
      value,
    };
    return value;
  };
  const branchRef = sourceBranch.startsWith("refs/heads/")
    ? sourceBranch
    : `refs/heads/${sourceBranch}`;
  if (spawnSync("git", ["check-ref-format", branchRef]).status !== 0) {
    return finish(false);
  }
  const actualCommonDir = gitCommand(sourceRepo, ["rev-parse", "--git-common-dir"]);
  if (!actualCommonDir) {
    return finish(false);
  }
  const resolvedCommonDir = path.resolve(sourceRepo, actualCommonDir);
  try {
    if (fs.realpathSync(resolvedCommonDir) !== fs.realpathSync(sourceGitCommonDir)) {
      return finish(false);
    }
  } catch {
    return finish(false);
  }
  if (gitCommand(sourceRepo, ["cat-file", "-e", `${sourceSha}^{commit}`]) === null) {
    return finish(false);
  }
  if (gitCommand(sourceRepo, ["rev-parse", "--verify", "HEAD^{commit}"]) !== sourceSha) {
    return finish(false);
  }
  if (gitCommand(sourceRepo, ["merge-base", "--is-ancestor", sourceSha, branchRef]) === null) {
    return finish(false);
  }
  return finish(gitCommand(sourceRepo, ["status", "--porcelain"]) === "");
}

function isFreshPastTimestamp(value: string | null): boolean {
  if (!value) {
    return false;
  }
  const timestamp = Date.parse(value);
  const now = Date.now();
  return (
    !Number.isNaN(timestamp) && timestamp <= now && timestamp >= now - REMOTE_PROVENANCE_MAX_AGE_MS
  );
}

function hasFreshRemoteProvenance(pointer: RuntimePointer, pointerPath: string): boolean {
  if (isFreshPastTimestamp(pointer.sourceRemoteVerifiedAt)) {
    return true;
  }
  const receiptsDirectory = path.join(path.dirname(pointerPath), "receipts");
  let names: string[];
  try {
    names = fs
      .readdirSync(receiptsDirectory)
      .filter((name) => /^source-provenance-\d{8}T\d{6}Z\.json$/u.test(name))
      .toSorted()
      .toReversed();
  } catch {
    return false;
  }
  for (const name of names) {
    try {
      const value = JSON.parse(
        fs.readFileSync(path.join(receiptsDirectory, name), "utf8"),
      ) as Record<string, unknown>;
      const matchesIdentity =
        value.schema === "openclaw.custom-runtime-source-provenance.v1" &&
        value.result === "passed" &&
        value.sourceSha === pointer.sourceSha &&
        value.sourceRemoteUrl === pointer.sourceRemoteUrl &&
        value.sourceRemoteRef === pointer.sourceRemoteRef &&
        value.sourceRemoteSha === pointer.sourceSha;
      if (matchesIdentity && isFreshPastTimestamp(nonEmptyString(value.verifiedAt))) {
        return true;
      }
    } catch {
      // Ignore a malformed receipt and keep looking for a fresh exact-identity receipt.
    }
  }
  return false;
}

export function resolveCustomRuntimeUpdatePolicy(
  options: CustomRuntimeUpdatePolicyOptions = {},
): CustomRuntimeUpdatePolicy {
  const env = options.env ?? process.env;
  const homedir = options.homedir ?? os.homedir();
  const argv = options.argv ?? process.argv;
  const pointerPath =
    options.pointerPath ??
    nonEmptyString(env.OPENCLAW_CUSTOM_RUNTIME_POINTER) ??
    path.join(homedir, ".openclaw-custom-runtime", "active-runtime.json");
  const pointer = readRuntimePointer(pointerPath);
  if (!pointer) {
    return {
      managedRuntime: false,
      standardUpdateBlocked: false,
      sourceDurable: false,
      sourceSha: null,
      sourceRepo: null,
      sourceBranch: null,
      runtimeRoot: null,
      pointerPath,
      reason: "No valid immutable custom-runtime pointer is active.",
    };
  }

  const snapshotRoot = nonEmptyString(env.OPENCLAW_RUNTIME_SNAPSHOT_ROOT);
  const wrapper = nonEmptyString(env.OPENCLAW_WRAPPER);
  const entrypoint = nonEmptyString(argv[1]);
  const durableSourceRoot = path.resolve(
    options.durableSourceRoot ??
      nonEmptyString(env.OPENCLAW_CUSTOM_RUNTIME_DURABLE_SOURCE_ROOT) ??
      homedir,
  );
  const managedRuntime =
    (snapshotRoot !== null && path.resolve(snapshotRoot) === pointer.runtimeRoot) ||
    (entrypoint !== null && isSameOrChild(entrypoint, pointer.runtimeRoot)) ||
    (wrapper !== null && path.basename(wrapper) === "custom-runtime-launcher.sh");
  const sourceDurable =
    /^[0-9a-f]{40}$/iu.test(pointer.sourceSha) &&
    pointer.sourceRepo !== null &&
    pointer.sourceGitCommonDir !== null &&
    pointer.sourceBranch !== null &&
    isPersistentSourceRepo(pointer.sourceRepo, durableSourceRoot) &&
    isPersistentSourceRepo(pointer.sourceGitCommonDir, durableSourceRoot) &&
    isValidLocalGitProvenance(pointer) &&
    isCredentialFreeRemoteUrl(pointer.sourceRemoteUrl) &&
    isDurableRecoveryRef(pointer.sourceRemoteRef) &&
    pointer.sourceRemoteSha === pointer.sourceSha &&
    hasFreshRemoteProvenance(pointer, pointerPath);
  return {
    managedRuntime,
    standardUpdateBlocked: managedRuntime,
    sourceDurable,
    sourceSha: pointer.sourceSha,
    sourceRepo: pointer.sourceRepo,
    sourceBranch: pointer.sourceBranch,
    runtimeRoot: pointer.runtimeRoot,
    pointerPath,
    reason: managedRuntime
      ? "This Gateway uses an immutable custom runtime; updates must pass through the custom-runtime broker."
      : "A custom-runtime pointer exists, but this process is not running from it.",
  };
}

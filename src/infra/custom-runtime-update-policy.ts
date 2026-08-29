import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
// Detect an active immutable custom runtime so generic self-update paths fail closed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const CUSTOM_RUNTIME_UPDATE_BROKER_REQUIRED_REASON = "custom-runtime-update-broker-required";

export type CustomRuntimeUpdatePolicy = {
  managedRuntime: boolean;
  standardUpdateBlocked: boolean;
  sourceDurable: boolean;
  sourceDurabilityReason: string;
  backupConfigured: boolean;
  approvalPending: boolean;
  pendingCandidateSha: string | null;
  preparationRunning: boolean;
  preparationStatus: "blocked" | "idle" | "preparing" | "ready" | "installing" | "failed";
  preparationReason: string | null;
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
};

type RuntimePointer = {
  runtimeRoot: string;
  entrypoint: string;
  sourceSha: string;
  sourceRepo: string | null;
  sourceBranch: string | null;
  sourceProvenance: RuntimeSourceProvenance | null;
};

type RuntimeSourceProvenance = {
  sourceSha: string;
  treeSha: string;
  objectFormat: string;
  recordPath: string;
  recordSha256: string;
  storePath: string;
  bundlePath: string;
  bundleSha256: string;
  sourceRemote: string;
  sourceRemoteBranch: string;
};

type SourceDurability = { durable: boolean; reason: string };

let sourceDurabilityCache: { key: string; value: SourceDurability } | undefined;

const UPDATE_SAFETY_CONFIG_SCHEMA = "openclaw.custom-runtime-update-safety-config.v1";

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function runtimeSourceProvenance(value: unknown): RuntimeSourceProvenance | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const sourceSha = nonEmptyString(record.sourceSha);
  const treeSha = nonEmptyString(record.treeSha);
  const objectFormat = nonEmptyString(record.objectFormat);
  const recordPath = nonEmptyString(record.recordPath);
  const recordSha256 = nonEmptyString(record.recordSha256);
  const storePath = nonEmptyString(record.storePath);
  const bundlePath = nonEmptyString(record.bundlePath);
  const bundleSha256 = nonEmptyString(record.bundleSha256);
  const sourceRemote = nonEmptyString(record.sourceRemote);
  const sourceRemoteBranch = nonEmptyString(record.sourceRemoteBranch);
  if (
    !sourceSha ||
    !treeSha ||
    !objectFormat ||
    !recordPath ||
    !recordSha256 ||
    !storePath ||
    !bundlePath ||
    !bundleSha256 ||
    !sourceRemote ||
    !sourceRemoteBranch
  ) {
    return null;
  }
  return {
    sourceSha,
    treeSha,
    objectFormat,
    recordPath: path.resolve(recordPath),
    recordSha256,
    storePath: path.resolve(storePath),
    bundlePath: path.resolve(bundlePath),
    bundleSha256,
    sourceRemote,
    sourceRemoteBranch,
  };
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
      sourceBranch: nonEmptyString(record.sourceBranch),
      sourceProvenance: runtimeSourceProvenance(record.sourceProvenance),
    };
  } catch {
    return null;
  }
}

function readPreparationState(pointerPath: string): {
  approvalPending: boolean;
  pendingCandidateSha: string | null;
  preparationRunning: boolean;
  preparationStatus: "idle" | "preparing" | "ready" | "installing" | "failed";
  preparationReason: string | null;
} {
  const runtimeHome = path.dirname(path.resolve(pointerPath));
  let approvalPending = false;
  let pendingCandidateSha: string | null = null;
  try {
    const pending: unknown = JSON.parse(
      fs.readFileSync(path.join(runtimeHome, "pending-update.json"), "utf8"),
    );
    if (pending && typeof pending === "object" && !Array.isArray(pending)) {
      const pendingRecord = pending as Record<string, unknown>;
      approvalPending = pendingRecord.result === "ready_for_approval";
      const candidateSha = nonEmptyString(pendingRecord.sourceSha);
      pendingCandidateSha =
        approvalPending && candidateSha && /^[0-9a-f]{40}$/u.test(candidateSha)
          ? candidateSha
          : null;
    }
  } catch {
    // Missing or malformed pending state cannot authorize installation.
  }
  const lockIsActive = (lockName: string): boolean => {
    try {
      const lockPath = path.join(runtimeHome, lockName);
      const lock = fs.lstatSync(lockPath);
      if (lock.isDirectory() && !lock.isSymbolicLink()) {
        const ageMs = Math.max(0, Date.now() - lock.mtimeMs);
        let ownerAlive = false;
        try {
          const owner: unknown = JSON.parse(
            fs.readFileSync(path.join(lockPath, "owner.json"), "utf8"),
          );
          const pid =
            owner && typeof owner === "object" && !Array.isArray(owner)
              ? (owner as Record<string, unknown>).pid
              : null;
          if (typeof pid === "number" && Number.isInteger(pid) && pid > 0) {
            try {
              process.kill(pid, 0);
              ownerAlive = true;
            } catch {
              ownerAlive = false;
            }
          }
        } catch {
          // A malformed recent lock remains protected by the recovery grace period.
        }
        return ownerAlive || ageMs < 30 * 60 * 1000;
      }
    } catch {
      // No lock means this operation is not currently recorded.
    }
    return false;
  };
  const preparationRunning = lockIsActive("update-preparation.lock");
  const installationRunning = lockIsActive("update-installation.lock");
  let preparationReason: string | null = null;
  let lastResult: string | null = null;
  try {
    const receiptsRoot = path.join(runtimeHome, "receipts");
    const latest = fs
      .readdirSync(receiptsRoot)
      .flatMap((name) => {
        const match = /^(?:update|update-approval)-(\d{8}T\d{6}Z)\.json$/u.exec(name);
        return match ? [{ name, stamp: match[1] }] : [];
      })
      .toSorted((left, right) => right.stamp.localeCompare(left.stamp))[0];
    if (latest) {
      const value: unknown = JSON.parse(
        fs.readFileSync(path.join(receiptsRoot, latest.name), "utf8"),
      );
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const record = value as Record<string, unknown>;
        lastResult = nonEmptyString(record.result);
        preparationReason = nonEmptyString(record.stage) ?? nonEmptyString(record.reason);
      }
    }
  } catch {
    // Immutable receipts are supplementary status; locks and pending proof remain authoritative.
  }
  const preparationStatus = preparationRunning
    ? "preparing"
    : installationRunning
      ? "installing"
      : approvalPending
        ? "ready"
        : lastResult === "failed"
          ? "failed"
          : "idle";
  return {
    approvalPending,
    pendingCandidateSha,
    preparationRunning,
    preparationStatus,
    preparationReason,
  };
}

function readBackupConfigured(pointerPath: string, env: NodeJS.ProcessEnv): boolean {
  let backupRoot = nonEmptyString(env.OPENCLAW_CUSTOM_RUNTIME_BACKUP_ROOT);
  if (!backupRoot) {
    try {
      const config: unknown = JSON.parse(
        fs.readFileSync(path.join(path.dirname(pointerPath), "update-safety.json"), "utf8"),
      );
      if (
        config &&
        typeof config === "object" &&
        !Array.isArray(config) &&
        (config as Record<string, unknown>).schema === UPDATE_SAFETY_CONFIG_SCHEMA
      ) {
        backupRoot = nonEmptyString((config as Record<string, unknown>).backupRoot);
      }
    } catch {
      return false;
    }
  }
  return backupRoot ? isRegularPath(path.resolve(backupRoot), "directory") : false;
}

function isRegularPath(target: string, kind: "file" | "directory"): boolean {
  try {
    const stat = fs.lstatSync(target);
    return !stat.isSymbolicLink() && (kind === "file" ? stat.isFile() : stat.isDirectory());
  } catch {
    return false;
  }
}

function gitStoreValue(storePath: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["--git-dir", storePath, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 8 * 1024 * 1024,
    }).trim();
  } catch {
    return null;
  }
}

function verifyProvenanceGitIdentity(
  provenance: RuntimeSourceProvenance,
  sourceBranch: string | null,
): boolean {
  if (
    gitStoreValue(provenance.storePath, ["rev-parse", "--is-bare-repository"]) !== "true" ||
    gitStoreValue(provenance.storePath, ["rev-parse", "--is-shallow-repository"]) !== "false" ||
    gitStoreValue(provenance.storePath, ["rev-parse", "--show-object-format"]) !==
      provenance.objectFormat ||
    gitStoreValue(provenance.storePath, ["rev-parse", `${provenance.sourceSha}^{commit}`]) !==
      provenance.sourceSha ||
    gitStoreValue(provenance.storePath, ["rev-parse", `${provenance.sourceSha}^{tree}`]) !==
      provenance.treeSha ||
    !sourceBranch ||
    gitStoreValue(provenance.storePath, ["rev-parse", `${sourceBranch}^{commit}`]) !==
      provenance.sourceSha ||
    gitStoreValue(provenance.storePath, ["remote", "get-url", "origin"]) !==
      provenance.sourceRemote ||
    gitStoreValue(provenance.storePath, [
      "rev-parse",
      `refs/remotes/origin/${provenance.sourceRemoteBranch}^{commit}`,
    ]) !== provenance.sourceSha
  ) {
    return false;
  }
  const alternatesValue = gitStoreValue(provenance.storePath, [
    "rev-parse",
    "--git-path",
    "objects/info/alternates",
  ]);
  if (!alternatesValue) {
    return false;
  }
  const alternatesPath = path.isAbsolute(alternatesValue)
    ? alternatesValue
    : path.resolve(provenance.storePath, alternatesValue);
  try {
    return !fs.existsSync(alternatesPath) || !fs.readFileSync(alternatesPath, "utf8").trim();
  } catch {
    return false;
  }
}

function resolveSourceDurability(pointer: RuntimePointer, pointerPath: string): SourceDurability {
  const cacheKey = JSON.stringify({
    pointerPath: path.resolve(pointerPath),
    sourceSha: pointer.sourceSha,
    sourceRepo: pointer.sourceRepo,
    sourceBranch: pointer.sourceBranch,
    sourceProvenance: pointer.sourceProvenance,
  });
  if (sourceDurabilityCache?.key === cacheKey) {
    return sourceDurabilityCache.value;
  }
  const resolved = resolveSourceDurabilityUncached(pointer, pointerPath);
  // Source provenance is process-stable. Cache the deep Git and bundle proof so
  // Dashboard status polling cannot repeatedly hash the recovery bundle.
  sourceDurabilityCache = { key: cacheKey, value: resolved };
  return resolved;
}

function resolveSourceDurabilityUncached(
  pointer: RuntimePointer,
  pointerPath: string,
): SourceDurability {
  const shaPattern = /^[0-9a-f]{40}$/u;
  const digestPattern = /^[0-9a-f]{64}$/u;
  if (!shaPattern.test(pointer.sourceSha)) {
    return { durable: false, reason: "The active source SHA is not an exact Git commit." };
  }
  const provenance = pointer.sourceProvenance;
  if (!provenance) {
    return {
      durable: false,
      reason: "The active pointer has no complete source-provenance binding.",
    };
  }
  if (
    provenance.sourceSha !== pointer.sourceSha ||
    !shaPattern.test(provenance.treeSha) ||
    provenance.objectFormat !== "sha1" ||
    !digestPattern.test(provenance.recordSha256) ||
    !digestPattern.test(provenance.bundleSha256)
  ) {
    return { durable: false, reason: "The active source-provenance identity is invalid." };
  }
  const provenanceRoot = path.join(path.dirname(path.resolve(pointerPath)), "source-provenance");
  if (!isSameOrChild(provenance.recordPath, provenanceRoot)) {
    return {
      durable: false,
      reason: "The source-provenance record is outside the managed runtime home.",
    };
  }
  if (
    !isRegularPath(provenance.recordPath, "file") ||
    !isRegularPath(provenance.storePath, "directory") ||
    !isRegularPath(provenance.bundlePath, "file")
  ) {
    return {
      durable: false,
      reason: "The source-provenance record, store, or recovery bundle is unavailable.",
    };
  }
  try {
    if (
      crypto.createHash("sha256").update(fs.readFileSync(provenance.bundlePath)).digest("hex") !==
      provenance.bundleSha256
    ) {
      return { durable: false, reason: "The source-provenance recovery bundle hash is invalid." };
    }
  } catch {
    return { durable: false, reason: "The source-provenance recovery bundle is unreadable." };
  }
  let recordBytes: Buffer;
  let record: Record<string, unknown>;
  try {
    recordBytes = fs.readFileSync(provenance.recordPath);
    const parsed: unknown = JSON.parse(recordBytes.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid record");
    }
    record = parsed as Record<string, unknown>;
  } catch {
    return { durable: false, reason: "The source-provenance record is unreadable or malformed." };
  }
  if (crypto.createHash("sha256").update(recordBytes).digest("hex") !== provenance.recordSha256) {
    return {
      durable: false,
      reason: "The source-provenance record hash does not match the active pointer.",
    };
  }
  const recordPath = nonEmptyString(record.recordPath);
  const recordStorePath = nonEmptyString(record.storePath);
  const recordBundlePath = nonEmptyString(record.bundlePath);
  if (
    record.schema !== "openclaw.custom-runtime-source-provenance.v1" ||
    record.version !== 1 ||
    record.sourceSha !== pointer.sourceSha ||
    record.treeSha !== provenance.treeSha ||
    record.objectFormat !== provenance.objectFormat ||
    !recordPath ||
    path.resolve(recordPath) !== provenance.recordPath ||
    !recordStorePath ||
    path.resolve(recordStorePath) !== provenance.storePath ||
    !recordBundlePath ||
    path.resolve(recordBundlePath) !== provenance.bundlePath ||
    record.bundleSha256 !== provenance.bundleSha256 ||
    record.sourceRemote !== provenance.sourceRemote ||
    record.sourceRemoteBranch !== provenance.sourceRemoteBranch
  ) {
    return {
      durable: false,
      reason: "The source-provenance record does not match the active pointer.",
    };
  }
  if (
    path.resolve(pointer.sourceRepo ?? "") !== provenance.storePath ||
    pointer.sourceBranch !== `refs/provenance/${pointer.sourceSha}` ||
    provenance.sourceRemote !== "https://github.com/SnowBelt/openclaw.git"
  ) {
    return {
      durable: false,
      reason: "The active source repository or branch is not provenance-bound.",
    };
  }
  if (!verifyProvenanceGitIdentity(provenance, pointer.sourceBranch)) {
    return {
      durable: false,
      reason:
        "The source-provenance Git store is not standalone or does not contain the bound source identity.",
    };
  }
  return {
    durable: true,
    reason: "The active source is bound to a private standalone Git store and recovery bundle.",
  };
}

function isSameOrChild(candidate: string, parent: string): boolean {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedParent = path.resolve(parent);
  return (
    resolvedCandidate === resolvedParent ||
    resolvedCandidate.startsWith(`${resolvedParent}${path.sep}`)
  );
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
      sourceDurabilityReason: "The immutable custom-runtime pointer is missing or invalid.",
      backupConfigured: false,
      approvalPending: false,
      pendingCandidateSha: null,
      preparationRunning: false,
      preparationStatus: "blocked",
      preparationReason: "invalid-active-runtime-pointer",
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
  const managedRuntime =
    (snapshotRoot !== null && path.resolve(snapshotRoot) === pointer.runtimeRoot) ||
    (entrypoint !== null && isSameOrChild(entrypoint, pointer.runtimeRoot)) ||
    (wrapper !== null && path.basename(wrapper) === "custom-runtime-launcher.sh");
  const sourceDurability = resolveSourceDurability(pointer, pointerPath);
  const preparation = readPreparationState(pointerPath);
  const backupConfigured = readBackupConfigured(pointerPath, env);
  const preparationBlocked = !sourceDurability.durable || !backupConfigured;
  return {
    managedRuntime,
    standardUpdateBlocked: managedRuntime,
    sourceDurable: sourceDurability.durable,
    sourceDurabilityReason: sourceDurability.reason,
    backupConfigured,
    approvalPending: preparation.approvalPending,
    pendingCandidateSha: preparation.pendingCandidateSha,
    preparationRunning: preparation.preparationRunning,
    preparationStatus: preparationBlocked ? "blocked" : preparation.preparationStatus,
    preparationReason: preparationBlocked
      ? !sourceDurability.durable
        ? "source-provenance-unavailable"
        : "verified-backup-unavailable"
      : preparation.preparationReason,
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

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
// Detect an active immutable custom runtime so generic self-update paths fail closed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const CUSTOM_RUNTIME_UPDATE_BROKER_REQUIRED_REASON = "custom-runtime-update-broker-required";

export type CustomRuntimeBackupStatus =
  | "unconfigured"
  | "offline"
  | "locked"
  | "ready"
  | "stale"
  | "failed";

export type CustomRuntimeRecoveryMode = "unconfigured" | "local_verified" | "external_encrypted";

export type CustomRuntimeRecoveryReadiness = {
  mode: CustomRuntimeRecoveryMode;
  localStatus: CustomRuntimeBackupStatus;
  externalStatus: CustomRuntimeBackupStatus | "not_configured";
  installationReady: boolean;
  blockingReasons: string[];
  advisories: string[];
};

export type CustomRuntimeUpdatePolicy = {
  managedRuntime: boolean;
  standardUpdateBlocked: boolean;
  sourceDurable: boolean;
  sourceDurabilityReason: string;
  backupConfigured: boolean;
  backupStatus: CustomRuntimeBackupStatus;
  backupStatusReason: string;
  recovery?: CustomRuntimeRecoveryReadiness;
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
  releaseId: string;
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

const UPDATE_SAFETY_CONFIG_SCHEMA = "openclaw.custom-runtime-update-safety-config.v2";
const UPDATE_BACKUP_RECEIPT_SCHEMA = "openclaw.custom-runtime-update-backup.v2";
const UPDATE_BACKUP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

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
    const releaseId = nonEmptyString(record.releaseId);
    if (!releaseId || !runtimeRoot || !entrypoint || !sourceSha) {
      return null;
    }
    const resolvedRoot = path.resolve(runtimeRoot);
    if (path.resolve(entrypoint) !== path.join(resolvedRoot, "dist", "index.js")) {
      return null;
    }
    return {
      releaseId,
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

type BackupState = {
  configured: boolean;
  status: CustomRuntimeBackupStatus;
  reason: string;
  recovery: CustomRuntimeRecoveryReadiness;
};

function backupReceiptBindingReason(
  value: unknown,
  label: string,
  allowedRoot: string,
): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return `The latest backup receipt has no valid ${label} binding.`;
  }
  const binding = value as Record<string, unknown>;
  const rawPath = nonEmptyString(binding.path);
  const digest = nonEmptyString(binding.sha256);
  if (!rawPath || !path.isAbsolute(rawPath) || !digest || !/^[0-9a-f]{64}$/u.test(digest)) {
    return `The latest backup receipt has an invalid ${label} binding.`;
  }
  const filePath = path.resolve(rawPath);
  if (!isSameOrChild(filePath, allowedRoot)) {
    return `The latest backup receipt points its ${label} outside the managed destination.`;
  }
  try {
    const info = fs.lstatSync(filePath);
    if (!info.isFile() || info.isSymbolicLink()) {
      return `The latest backup receipt ${label} is not a regular file.`;
    }
    const realRoot = fs.realpathSync(allowedRoot);
    const realFile = fs.realpathSync(filePath);
    if (!isSameOrChild(realFile, realRoot)) {
      return `The latest backup receipt points its ${label} through a managed-path symlink.`;
    }
  } catch {
    return `The latest verified ${label} is not currently available.`;
  }
  return null;
}

function backupReceiptTimestamp(value: unknown): number {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return Number.NaN;
}

function latestBackupReceipt(runtimeHome: string): string | null {
  const receiptsRoot = path.join(runtimeHome, "receipts");
  let names: string[];
  try {
    names = fs.readdirSync(receiptsRoot).filter((name) => /^update-backup-.*\.json$/u.test(name));
  } catch {
    return null;
  }
  const candidates = names
    .map((name) => {
      const filePath = path.join(receiptsRoot, name);
      try {
        const info = fs.lstatSync(filePath);
        return {
          filePath,
          timestamp: info.mtimeMs,
        };
      } catch {
        return null;
      }
    })
    .filter((value): value is { filePath: string; timestamp: number } => value !== null)
    .toSorted(
      (left, right) =>
        right.timestamp - left.timestamp || right.filePath.localeCompare(left.filePath),
    );
  return candidates[0]?.filePath ?? null;
}

function backupState(params: {
  configured: boolean;
  mode: CustomRuntimeRecoveryMode;
  status: CustomRuntimeBackupStatus;
  reason: string;
  localStatus?: CustomRuntimeBackupStatus;
  externalStatus?: CustomRuntimeBackupStatus | "not_configured";
}): BackupState {
  const externalStatus = params.externalStatus ?? "not_configured";
  const installationReady =
    params.status === "ready" && (params.mode === "local_verified" || externalStatus === "ready");
  return {
    configured: params.configured,
    status: params.status,
    reason: params.reason,
    recovery: {
      mode: params.mode,
      localStatus: params.localStatus ?? params.status,
      externalStatus,
      installationReady,
      blockingReasons: installationReady ? [] : [params.reason],
      advisories:
        params.mode === "local_verified"
          ? ["Hardware-disaster recovery is not configured on encrypted external storage."]
          : [],
    },
  };
}

function readBackupState(pointerPath: string, sourceSha: string, releaseId: string): BackupState {
  const runtimeHome = path.dirname(path.resolve(pointerPath));
  const localRoot = path.join(runtimeHome, "data-backups");
  const configPath = path.join(runtimeHome, "update-safety.json");
  let config: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("invalid config");
    }
    config = value as Record<string, unknown>;
  } catch {
    return backupState({
      configured: false,
      mode: "unconfigured",
      status: "unconfigured",
      reason: "No update recovery mode has been configured.",
    });
  }
  if (config.schema !== UPDATE_SAFETY_CONFIG_SCHEMA) {
    return backupState({
      configured: false,
      mode: "unconfigured",
      status: "failed",
      reason: "The update-safety backup configuration has an unsupported schema.",
    });
  }
  const mode = config.mode;
  if (mode !== "local_verified" && mode !== "external_encrypted") {
    return backupState({
      configured: false,
      mode: "unconfigured",
      status: "failed",
      reason: "The configured update recovery mode is invalid.",
    });
  }

  const backupRoot = mode === "external_encrypted" ? nonEmptyString(config.backupRoot) : null;
  if (mode === "external_encrypted" && !backupRoot) {
    return backupState({
      configured: false,
      mode,
      status: "failed",
      reason: "The encrypted external recovery mode has no backup destination.",
      externalStatus: "failed",
    });
  }
  const resolvedRoot = backupRoot ? path.resolve(backupRoot) : null;
  let externalStatus: CustomRuntimeBackupStatus | "not_configured" = "not_configured";
  let externalReason: string | null = null;
  if (resolvedRoot) {
    try {
      const rootInfo = fs.lstatSync(resolvedRoot);
      if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
        externalStatus = "failed";
        externalReason = "The configured backup destination is not a regular directory.";
      } else {
        fs.accessSync(resolvedRoot, fs.constants.R_OK | fs.constants.W_OK);
        externalStatus = "ready";
      }
    } catch (error) {
      const code =
        error && typeof error === "object" ? (error as NodeJS.ErrnoException).code : null;
      externalStatus = code === "EACCES" ? "locked" : "offline";
      externalReason =
        code === "EACCES"
          ? "The configured backup destination is present but access is denied or locked."
          : "The configured backup destination is not currently mounted or available.";
    }
  }

  try {
    const localRootInfo = fs.lstatSync(localRoot);
    if (!localRootInfo.isDirectory() || localRootInfo.isSymbolicLink()) {
      return backupState({
        configured: true,
        mode,
        status: "failed",
        reason: "The local backup destination is not a regular directory.",
        externalStatus,
      });
    }
  } catch (error) {
    const code = error && typeof error === "object" ? (error as NodeJS.ErrnoException).code : null;
    if (code !== "ENOENT") {
      return backupState({
        configured: true,
        mode,
        status: "failed",
        reason: "The local backup destination is unavailable.",
        externalStatus,
      });
    }
  }

  const receiptPath = latestBackupReceipt(runtimeHome);
  if (!receiptPath) {
    return backupState({
      configured: true,
      mode,
      status: "stale",
      reason: "The recovery mode is configured, but no verified recovery receipt exists.",
      externalStatus,
    });
  }
  try {
    const receiptInfo = fs.lstatSync(receiptPath);
    if (!receiptInfo.isFile() || receiptInfo.isSymbolicLink() || receiptInfo.mode & 0o077) {
      throw new Error("invalid receipt permissions");
    }
  } catch {
    return backupState({
      configured: true,
      mode,
      status: "failed",
      reason: "The latest backup receipt is unavailable or is not a private regular file.",
      externalStatus,
    });
  }

  let receipt: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("invalid receipt");
    }
    receipt = value as Record<string, unknown>;
  } catch {
    return backupState({
      configured: true,
      mode,
      status: "failed",
      reason: "The latest backup receipt is malformed.",
      externalStatus,
    });
  }
  const restoreDrill =
    receipt.restoreDrill &&
    typeof receipt.restoreDrill === "object" &&
    !Array.isArray(receipt.restoreDrill)
      ? (receipt.restoreDrill as Record<string, unknown>)
      : null;
  if (
    receipt.schema !== UPDATE_BACKUP_RECEIPT_SCHEMA ||
    receipt.mode !== mode ||
    receipt.result !== "passed" ||
    receipt.backupVerified !== true ||
    restoreDrill?.result !== "passed"
  ) {
    return backupState({
      configured: true,
      mode,
      status: "failed",
      reason: "The latest backup receipt did not prove a verified restore rehearsal.",
      externalStatus,
    });
  }
  if (receipt.sourceSha !== sourceSha) {
    return backupState({
      configured: true,
      mode,
      status: "stale",
      reason: "The latest verified backup belongs to a different active source SHA.",
      externalStatus,
    });
  }
  if (receipt.releaseId !== releaseId) {
    return backupState({
      configured: true,
      mode,
      status: "stale",
      reason: "The latest verified backup belongs to a different active runtime release.",
      externalStatus,
    });
  }
  const createdAt = backupReceiptTimestamp(receipt.createdAt);
  if (
    !Number.isFinite(createdAt) ||
    createdAt > Date.now() + 60_000 ||
    Date.now() - createdAt > UPDATE_BACKUP_MAX_AGE_MS
  ) {
    return backupState({
      configured: true,
      mode,
      status: "stale",
      reason: "The latest verified backup is older than the permitted recovery window.",
      externalStatus,
    });
  }

  // Status polling validates private path shape and containment. Operational
  // prepare/install gates re-hash every binding before any runtime mutation.
  for (const label of ["localArchive", "controlPlane"] as const) {
    const reason = backupReceiptBindingReason(receipt[label], label, localRoot);
    if (reason) {
      return backupState({
        configured: true,
        mode,
        status: "failed",
        reason,
        externalStatus,
      });
    }
  }
  if (resolvedRoot && externalStatus === "ready") {
    for (const label of ["externalArchive", "externalControlPlane"] as const) {
      const reason = backupReceiptBindingReason(receipt[label], label, resolvedRoot);
      if (reason) {
        return backupState({
          configured: true,
          mode,
          status: "failed",
          reason,
          localStatus: "ready",
          externalStatus: "failed",
        });
      }
    }
  }
  if (mode === "external_encrypted" && externalStatus !== "ready") {
    return backupState({
      configured: true,
      mode,
      status: externalStatus === "not_configured" ? "failed" : externalStatus,
      reason: externalReason ?? "Encrypted external recovery is not ready.",
      localStatus: "ready",
      externalStatus,
    });
  }
  return backupState({
    configured: true,
    mode,
    status: "ready",
    reason:
      mode === "local_verified"
        ? "The recent local backup and verified restore rehearsal are ready."
        : "The local and encrypted external recovery points are ready.",
    localStatus: "ready",
    externalStatus,
  });
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
      backupStatus: "unconfigured",
      backupStatusReason: "No update recovery mode has been configured.",
      recovery: {
        mode: "unconfigured",
        localStatus: "unconfigured",
        externalStatus: "not_configured",
        installationReady: false,
        blockingReasons: ["The immutable custom-runtime pointer is missing or invalid."],
        advisories: [],
      },
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
  const backup = readBackupState(pointerPath, pointer.sourceSha, pointer.releaseId);
  const backupConfigured =
    backup.configured && (backup.status === "ready" || backup.status === "stale");
  const preparationBlocked = !sourceDurability.durable || !backupConfigured;
  return {
    managedRuntime,
    standardUpdateBlocked: managedRuntime,
    sourceDurable: sourceDurability.durable,
    sourceDurabilityReason: sourceDurability.reason,
    backupConfigured,
    backupStatus: backup.status,
    backupStatusReason: backup.reason,
    recovery: backup.recovery,
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

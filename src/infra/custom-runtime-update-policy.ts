import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
// Detect an active immutable custom runtime so generic self-update paths fail closed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createConfigIO } from "../config/io.js";

export const CUSTOM_RUNTIME_UPDATE_BROKER_REQUIRED_REASON = "custom-runtime-update-broker-required";

/** Machine-readable reasons the Dashboard can safely turn into one next action. */
export type CustomRuntimeUpdateBlockerCode =
  | "active_runtime_pointer_invalid"
  | "source_provenance_incomplete"
  | "runtime_guard_unhealthy"
  | "backup_destination_unavailable"
  | "candidate_stale_active_runtime"
  | "candidate_proof_required";

export type CustomRuntimeUpdatePolicy = {
  managedRuntime: boolean;
  standardUpdateBlocked: boolean;
  sourceDurable: boolean;
  sourceDurabilityReason: string;
  runtimeGuardHealthy: boolean;
  runtimeGuardReason: string;
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
  /** Present only when a managed runtime cannot prepare or install safely. */
  blockerCodes?: readonly CustomRuntimeUpdateBlockerCode[];
  /** Short operator-facing action paired with blockerCodes. */
  recommendedAction?: string;
};

export type CustomRuntimeUpdatePolicyOptions = {
  env?: NodeJS.ProcessEnv;
  homedir?: string;
  argv?: readonly string[];
  pointerPath?: string;
  runtimeGuardLaunchAgentPath?: string;
  runtimeGuardLabel?: string;
  runtimeGuardLoaded?: boolean;
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
const RUNTIME_GUARD_RECEIPT_SCHEMA = "openclaw.custom-runtime-guard-verification.v1";
const RUNTIME_GUARD_RECEIPT_TTL_MS = 15 * 60 * 1000;
const RUNTIME_GUARD_LABEL = "ai.openclaw.custom-runtime.guard";

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isLaunchAgentLoaded(label: string): boolean {
  if (process.platform !== "darwin" || typeof process.getuid !== "function") {
    return false;
  }
  try {
    execFileSync("/bin/launchctl", ["print", `gui/${process.getuid()}/${label}`], {
      stdio: "ignore",
      timeout: 1_000,
    });
    return true;
  } catch {
    return false;
  }
}

function readRuntimeGuardAgentHealth(options: {
  homedir: string;
  launchAgentPath?: string;
  label?: string;
  programArguments?: string[];
  loaded?: boolean;
}): { healthy: boolean; reason: string } {
  const launchAgentPath =
    options.launchAgentPath ??
    path.join(options.homedir, "Library", "LaunchAgents", "ai.openclaw.custom-runtime.guard.plist");
  try {
    const stat = fs.lstatSync(launchAgentPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      return { healthy: false, reason: "The recovery guard LaunchAgent is invalid." };
    }
  } catch {
    return { healthy: false, reason: "The recovery guard LaunchAgent is missing." };
  }
  if (options.programArguments) {
    try {
      execFileSync(
        "python3",
        [
          "-c",
          "import json, os, plistlib, sys\nwith open(sys.argv[1], 'rb') as f: value = plistlib.load(f)\nargs = value.get('ProgramArguments')\nactual = [os.path.realpath(item) for item in args] if isinstance(args, list) and all(isinstance(item, str) and item for item in args) else []\nexpected = [os.path.realpath(item) for item in json.loads(sys.argv[3])]\nraise SystemExit(0 if value.get('Label') == sys.argv[2] and actual == expected else 1)",
          launchAgentPath,
          options.label ?? RUNTIME_GUARD_LABEL,
          JSON.stringify(options.programArguments),
        ],
        { stdio: "ignore" },
      );
    } catch {
      return { healthy: false, reason: "The recovery guard LaunchAgent contract is invalid." };
    }
  }
  if (!(options.loaded ?? isLaunchAgentLoaded(options.label ?? RUNTIME_GUARD_LABEL))) {
    return { healthy: false, reason: "The recovery guard LaunchAgent is not loaded." };
  }
  return { healthy: true, reason: "The recovery guard LaunchAgent is loaded." };
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

function readPreparationState(
  pointerPath: string,
  activeSha: string | null,
): {
  approvalPending: boolean;
  pendingCandidateSha: string | null;
  preparationRunning: boolean;
  preparationStatus: "idle" | "preparing" | "ready" | "installing" | "failed";
  preparationReason: string | null;
} {
  const runtimeHome = path.dirname(path.resolve(pointerPath));
  let approvalPending = false;
  let pendingCandidateSha: string | null = null;
  let pendingCandidateNeedsRepreparation = false;
  try {
    const pending: unknown = JSON.parse(
      fs.readFileSync(path.join(runtimeHome, "pending-update.json"), "utf8"),
    );
    if (pending && typeof pending === "object" && !Array.isArray(pending)) {
      const pendingRecord = pending as Record<string, unknown>;
      const readyForApproval = pendingRecord.result === "ready_for_approval";
      const baseSha = nonEmptyString(pendingRecord.baseSha);
      const activeRuntimeChanged =
        readyForApproval && baseSha !== null && activeSha !== null && baseSha !== activeSha;
      const verifiedBackup = pendingRecord.verifiedBackup;
      const backupSchema =
        verifiedBackup && typeof verifiedBackup === "object" && !Array.isArray(verifiedBackup)
          ? nonEmptyString((verifiedBackup as Record<string, unknown>).schema)
          : null;
      const repositoryProof = pendingRecord.repositoryProof;
      const repositoryProofSchema =
        repositoryProof && typeof repositoryProof === "object" && !Array.isArray(repositoryProof)
          ? nonEmptyString((repositoryProof as Record<string, unknown>).schema)
          : null;
      pendingCandidateNeedsRepreparation =
        readyForApproval &&
        (backupSchema !== "openclaw.custom-runtime-update-backup.v2" ||
          repositoryProofSchema !== "openclaw.custom-runtime-github-proof.v1" ||
          baseSha === null ||
          activeRuntimeChanged);
      approvalPending = readyForApproval && !pendingCandidateNeedsRepreparation;
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
        : pendingCandidateNeedsRepreparation
          ? "idle"
          : lastResult === "failed"
            ? "failed"
            : "idle";
  if (pendingCandidateNeedsRepreparation) {
    let pendingReason = "pending-update-proof-repreparation-required";
    try {
      const pending: unknown = JSON.parse(
        fs.readFileSync(path.join(runtimeHome, "pending-update.json"), "utf8"),
      );
      const pendingRecord =
        pending && typeof pending === "object" && !Array.isArray(pending)
          ? (pending as Record<string, unknown>)
          : null;
      const baseSha = pendingRecord ? nonEmptyString(pendingRecord.baseSha) : null;
      if (pendingRecord && baseSha !== null && activeSha !== null && baseSha !== activeSha) {
        pendingReason = "pending-update-active-runtime-changed";
      }
    } catch {
      // The generic proof-repreparation reason is safer when pending state is unreadable.
    }
    preparationReason = pendingReason;
  }
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

async function readRuntimeGuardHealth(
  pointerPath: string,
  pointer: RuntimePointer,
  env: NodeJS.ProcessEnv,
  homedir: string,
  guardLaunchAgentPath: string,
  guardLabel: string,
): Promise<{ healthy: boolean; reason: string }> {
  const receiptPath = path.join(
    path.dirname(path.resolve(pointerPath)),
    "receipts",
    "guard-verification-current.json",
  );
  try {
    const stat = fs.lstatSync(receiptPath);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
      throw new Error("unsafe guard receipt");
    }
    const raw: unknown = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("invalid guard receipt");
    }
    const receipt = raw as Record<string, unknown>;
    const verifiedAt = receipt.verifiedAt;
    const runtimeHome = path.dirname(path.resolve(pointerPath));
    const launcherPath = path.join(runtimeHome, "bin", "custom-runtime-launcher.sh");
    const guardExecutablePath = path.join(runtimeHome, "bin", "custom-runtime-guard.sh");
    const gatewayEnvWrapperPath = path.resolve(
      nonEmptyString(env.OPENCLAW_GATEWAY_ENV_WRAPPER) ??
        path.join(
          homedir,
          ".openclaw-director-state",
          "service-env",
          "ai.openclaw.gateway-env-wrapper.sh",
        ),
    );
    const gatewayEnvFilePath = path.resolve(
      nonEmptyString(env.OPENCLAW_GATEWAY_ENV_FILE) ??
        path.join(homedir, ".openclaw-director-state", "service-env", "ai.openclaw.gateway.env"),
    );
    const guardProgramArguments = [
      fs.realpathSync("/bin/sh"),
      fs.realpathSync(gatewayEnvWrapperPath),
      fs.realpathSync(gatewayEnvFilePath),
      fs.realpathSync(guardExecutablePath),
    ];
    const plistPath = path.resolve(
      nonEmptyString(env.OPENCLAW_GATEWAY_PLIST) ??
        path.join(homedir, "Library", "LaunchAgents", "ai.openclaw.gateway.plist"),
    );
    const configPath = path.resolve(
      nonEmptyString(env.OPENCLAW_CONFIG_PATH) ??
        path.join(homedir, ".openclaw", "openclaw.director.json"),
    );
    const provenancePath = path.join(pointer.runtimeRoot, ".openclaw-runtime-provenance.json");
    const dashboardManifestPath = path.join(
      pointer.runtimeRoot,
      "dist",
      "control-ui",
      "dashboard-surfaces.json",
    );
    const provenance = JSON.parse(fs.readFileSync(provenancePath, "utf8")) as Record<
      string,
      unknown
    >;
    const provenanceRecord = nonEmptyString(provenance.recordPath);
    if (!provenanceRecord) {
      throw new Error("source provenance record path is missing");
    }
    const provenanceRecordPath = path.resolve(provenanceRecord);
    const provenanceMigrationPath = nonEmptyString(provenance.migrationPath);
    const sha256 = (filePath: string): string => {
      const info = fs.lstatSync(filePath);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new Error("unsafe guard input");
      }
      return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
    };
    const configSnapshot = await createConfigIO({
      env: { ...env, OPENCLAW_CONFIG_PATH: configPath },
      homedir: () => homedir,
      observe: false,
      pluginValidation: "skip",
      shellEnvFallback: "defer",
    }).readConfigFileSnapshot();
    if (!configSnapshot.valid) {
      throw new Error("managed OpenClaw config is invalid");
    }
    const config = configSnapshot.config;
    const gatewayAuth = config.gateway?.auth ?? null;
    const gatewayControlUi = config.gateway?.controlUi ?? {};
    const gatewayConfigSha256 = crypto
      .createHash("sha256")
      .update(`${JSON.stringify(gatewayAuth)}\n${JSON.stringify(gatewayControlUi)}\n`)
      .digest("hex");
    if (
      receipt.schema !== RUNTIME_GUARD_RECEIPT_SCHEMA ||
      receipt.result !== "passed" ||
      receipt.runtimeRoot !== pointer.runtimeRoot ||
      receipt.sourceSha !== pointer.sourceSha ||
      receipt.pointerSha256 !== sha256(pointerPath) ||
      receipt.launcherSha256 !== sha256(launcherPath) ||
      receipt.plistSha256 !== sha256(plistPath) ||
      receipt.guardPlistPath !== fs.realpathSync(guardLaunchAgentPath) ||
      receipt.guardPlistSha256 !== sha256(guardLaunchAgentPath) ||
      receipt.guardExecutablePath !== fs.realpathSync(guardExecutablePath) ||
      receipt.guardExecutableSha256 !== sha256(guardExecutablePath) ||
      receipt.guardLabel !== guardLabel ||
      receipt.gatewayEnvWrapperPath !== fs.realpathSync(gatewayEnvWrapperPath) ||
      receipt.gatewayEnvWrapperSha256 !== sha256(gatewayEnvWrapperPath) ||
      receipt.gatewayEnvFilePath !== fs.realpathSync(gatewayEnvFilePath) ||
      receipt.gatewayEnvFileSha256 !== sha256(gatewayEnvFilePath) ||
      JSON.stringify(receipt.guardProgramArguments) !== JSON.stringify(guardProgramArguments) ||
      receipt.provenanceSha256 !== sha256(provenancePath) ||
      receipt.provenanceRecordSha256 !== sha256(provenanceRecordPath) ||
      receipt.provenanceMigrationSha256 !==
        (provenanceMigrationPath ? sha256(path.resolve(provenanceMigrationPath)) : "") ||
      receipt.dashboardManifestSha256 !== sha256(dashboardManifestPath) ||
      receipt.gatewayConfigSha256 !== gatewayConfigSha256 ||
      typeof verifiedAt !== "number" ||
      !Number.isInteger(verifiedAt) ||
      verifiedAt < 0 ||
      Date.now() - verifiedAt * 1000 > RUNTIME_GUARD_RECEIPT_TTL_MS ||
      verifiedAt * 1000 > Date.now() + 60_000
    ) {
      throw new Error("stale or mismatched guard receipt");
    }
    return {
      healthy: true,
      reason: "The active runtime guard has current identity and route proof.",
    };
  } catch {
    return {
      healthy: false,
      reason: "The active runtime guard has no current identity and route verification.",
    };
  }
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

export async function resolveCustomRuntimeUpdatePolicy(
  options: CustomRuntimeUpdatePolicyOptions = {},
): Promise<CustomRuntimeUpdatePolicy> {
  const env = options.env ?? process.env;
  const homedir = options.homedir ?? os.homedir();
  const argv = options.argv ?? process.argv;
  const explicitPointerPath = nonEmptyString(env.OPENCLAW_CUSTOM_RUNTIME_POINTER);
  const pointerPath =
    options.pointerPath ??
    explicitPointerPath ??
    path.join(homedir, ".openclaw-custom-runtime", "active-runtime.json");
  const snapshotRoot = nonEmptyString(env.OPENCLAW_RUNTIME_SNAPSHOT_ROOT);
  const wrapper = nonEmptyString(env.OPENCLAW_WRAPPER);
  const managedRuntimeMarker =
    explicitPointerPath !== null ||
    (wrapper !== null && path.basename(wrapper) === "custom-runtime-launcher.sh");
  const pointer = readRuntimePointer(pointerPath);
  if (!pointer) {
    return {
      managedRuntime: managedRuntimeMarker,
      standardUpdateBlocked: managedRuntimeMarker,
      sourceDurable: false,
      sourceDurabilityReason: "The immutable custom-runtime pointer is missing or invalid.",
      runtimeGuardHealthy: false,
      runtimeGuardReason: "The active runtime guard cannot verify an invalid runtime pointer.",
      backupConfigured: false,
      approvalPending: false,
      pendingCandidateSha: null,
      preparationRunning: false,
      preparationStatus: managedRuntimeMarker ? "blocked" : "idle",
      preparationReason: managedRuntimeMarker ? "invalid-active-runtime-pointer" : null,
      sourceSha: null,
      sourceRepo: null,
      sourceBranch: null,
      runtimeRoot: null,
      pointerPath,
      reason: managedRuntimeMarker
        ? "No valid immutable custom-runtime pointer is active."
        : "No managed custom runtime is active.",
    };
  }

  const entrypoint = nonEmptyString(argv[1]);
  const managedRuntime =
    (snapshotRoot !== null && path.resolve(snapshotRoot) === pointer.runtimeRoot) ||
    (entrypoint !== null && isSameOrChild(entrypoint, pointer.runtimeRoot)) ||
    (wrapper !== null && path.basename(wrapper) === "custom-runtime-launcher.sh");
  const sourceDurability = resolveSourceDurability(pointer, pointerPath);
  const guardLaunchAgentPath = path.resolve(
    options.runtimeGuardLaunchAgentPath ??
      nonEmptyString(env.OPENCLAW_CUSTOM_RUNTIME_GUARD_PLIST) ??
      path.join(homedir, "Library", "LaunchAgents", "ai.openclaw.custom-runtime.guard.plist"),
  );
  const guardLabel =
    options.runtimeGuardLabel ??
    nonEmptyString(env.OPENCLAW_CUSTOM_RUNTIME_GUARD_LABEL) ??
    RUNTIME_GUARD_LABEL;
  const runtimeGuardReceipt = await readRuntimeGuardHealth(
    pointerPath,
    pointer,
    env,
    homedir,
    guardLaunchAgentPath,
    guardLabel,
  );
  const runtimeGuardAgent = readRuntimeGuardAgentHealth({
    homedir,
    launchAgentPath: guardLaunchAgentPath,
    label: guardLabel,
    programArguments: [
      "/bin/sh",
      nonEmptyString(env.OPENCLAW_GATEWAY_ENV_WRAPPER) ??
        path.join(
          homedir,
          ".openclaw-director-state",
          "service-env",
          "ai.openclaw.gateway-env-wrapper.sh",
        ),
      nonEmptyString(env.OPENCLAW_GATEWAY_ENV_FILE) ??
        path.join(homedir, ".openclaw-director-state", "service-env", "ai.openclaw.gateway.env"),
      path.join(path.dirname(path.resolve(pointerPath)), "bin", "custom-runtime-guard.sh"),
    ],
    ...(options.runtimeGuardLoaded === undefined ? {} : { loaded: options.runtimeGuardLoaded }),
  });
  const runtimeGuard = runtimeGuardReceipt.healthy ? runtimeGuardAgent : runtimeGuardReceipt;
  const preparation = readPreparationState(pointerPath, pointer.sourceSha);
  const backupConfigured = readBackupConfigured(pointerPath, env);
  const preparationBlocked =
    !sourceDurability.durable || !runtimeGuard.healthy || !backupConfigured;
  const blockerCodes: CustomRuntimeUpdateBlockerCode[] = [];
  if (!managedRuntime) {
    // Unmanaged installs have no custom-runtime update contract to report.
  } else {
    if (!sourceDurability.durable) {
      blockerCodes.push("source_provenance_incomplete");
    }
    if (!runtimeGuard.healthy) {
      blockerCodes.push("runtime_guard_unhealthy");
    }
    if (!backupConfigured) {
      blockerCodes.push("backup_destination_unavailable");
    }
    if (preparation.preparationReason === "pending-update-active-runtime-changed") {
      blockerCodes.push("candidate_stale_active_runtime");
    }
    if (preparation.preparationStatus === "failed") {
      blockerCodes.push("candidate_proof_required");
    }
  }
  const recommendedAction = blockerCodes.includes("backup_destination_unavailable")
    ? "Connect the encrypted backup destination and run a verified restore rehearsal before installation."
    : blockerCodes.includes("candidate_stale_active_runtime")
      ? "Prepare the update again from the current active runtime."
      : blockerCodes.includes("source_provenance_incomplete")
        ? "Repair durable source provenance before preparing an update."
        : blockerCodes.includes("runtime_guard_unhealthy")
          ? "Repair and verify the custom-runtime recovery guard."
          : blockerCodes.includes("candidate_proof_required")
            ? "Review the failed proof and prepare a new candidate."
            : undefined;
  return {
    managedRuntime,
    standardUpdateBlocked: managedRuntime,
    sourceDurable: sourceDurability.durable,
    sourceDurabilityReason: sourceDurability.reason,
    runtimeGuardHealthy: runtimeGuard.healthy,
    runtimeGuardReason: runtimeGuard.reason,
    backupConfigured,
    approvalPending: preparation.approvalPending,
    pendingCandidateSha: preparation.pendingCandidateSha,
    preparationRunning: preparation.preparationRunning,
    preparationStatus: preparationBlocked ? "blocked" : preparation.preparationStatus,
    preparationReason: preparationBlocked
      ? !sourceDurability.durable
        ? "source-provenance-unavailable"
        : !runtimeGuard.healthy
          ? "runtime-guard-verification-unavailable"
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
    ...(blockerCodes.length > 0 ? { blockerCodes } : {}),
    ...(recommendedAction ? { recommendedAction } : {}),
  };
}

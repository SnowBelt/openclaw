import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { appendSelfImprovementAuditEvent } from "./audit-events.js";
import { recordSelfImprovementSignal as recordTypedSelfImprovementSignal } from "./signals.js";

export const RELEASE_INTEGRITY_LEASE_ENV = "OPENCLAW_RELEASE_INTEGRITY_LEASE_PATH";
export const RELEASE_INTEGRITY_STATUS_ENV = "OPENCLAW_RELEASE_INTEGRITY_STATUS_PATH";
export const RELEASE_INTEGRITY_REQUEST_DIR_ENV = "OPENCLAW_RELEASE_INTEGRITY_REQUEST_DIR";
export const RELEASE_INTEGRITY_INTERVAL_MS = 15 * 60_000;

export const RELEASE_INTEGRITY_SIGNALS = [
  "release.candidate_root_mismatch",
  "release.closure_mismatch",
  "release.source_unavailable",
  "release.lineage_migration_required",
  "release.feature_parity_failed",
  "release.performance_regression",
] as const;
export type ReleaseIntegritySignal = (typeof RELEASE_INTEGRITY_SIGNALS)[number];

export const RELEASE_INTEGRITY_ACTIONS = [
  "quarantine-candidate",
  "rebuild-disposable-candidate",
  "restore-source-capsule",
  "request-lineage-migration",
  "rerun-verification",
  "defer-background-work",
  "rollback-canary",
] as const;
export type ReleaseIntegrityAction = (typeof RELEASE_INTEGRITY_ACTIONS)[number];

type ReleaseIntegrityChecks = {
  candidateRoot: boolean;
  closure: boolean;
  sourceAvailable: boolean;
  lineageAuthorized: boolean;
  featureParity: boolean;
  performance: boolean;
};

export type ReleaseIntegritySnapshot = {
  version: 1;
  candidateId: string;
  runtimeIdentitySha256: string;
  activeParentRuntimeIdentity: string;
  canaryActive: boolean;
  checks: ReleaseIntegrityChecks;
  stateSha256: string;
};

type ReleaseIntegrityLease = {
  version: 1;
  governor: "release-integrity";
  candidateId: string;
  runtimeIdentitySha256: string;
  activeParentRuntimeIdentity: string;
  expiresAt: number;
  allowedActions: ReleaseIntegrityAction[];
  evidenceBundleSha256: string;
  qualityCanary: { passed: true; checkedAt: number };
};

type LoadedLease = { lease: ReleaseIntegrityLease; digest: string };

export type ReleaseIntegrityRemediationResult = {
  applied: boolean;
  postStateSha256?: string;
  rollback?: () => Promise<void> | void;
  rollbackReceiptSha256?: string;
};

export type ReleaseIntegrityCycleResult = {
  status:
    | "healthy"
    | "status-invalid"
    | "lease-invalid"
    | "no-authorized-action"
    | "repair-requested"
    | "applied"
    | "rolled-back";
  checkedAt: number;
  signal?: ReleaseIntegritySignal;
  action?: ReleaseIntegrityAction;
  candidateId?: string;
  leaseDigest?: string;
  reason: string;
  rollbackError?: string;
};

type ReleaseIntegrityLog = { error: (message: string) => void };

type ReleaseIntegritySignalRecordInput = {
  stateDir?: string;
  now?: number;
  idempotencyKey: string;
  title: string;
  summary: string;
  category: "efficiency_opportunity" | "risk_prevention";
  severity: "high" | "critical";
  evidence: string[];
  source: "gateway";
  sourceRef: string;
};

async function recordReleaseIntegritySignal(input: ReleaseIntegritySignalRecordInput) {
  return await recordTypedSelfImprovementSignal({
    stateDir: input.stateDir,
    now: input.now,
    input: {
      version: 1,
      idempotencyKey: input.idempotencyKey,
      source: { component: "release-integrity-supervisor" },
      kind: input.category === "efficiency_opportunity" ? "inefficiency" : "failure",
      severity: input.severity,
      summary: `${input.title}: ${input.summary}`,
      errorCode: input.sourceRef,
      evidenceRefs: input.evidence,
      privacy: "internal",
      trusted: true,
    },
  });
}

type ReleaseIntegrityDeps = {
  now?: () => number;
  readSnapshot?: (statusPath: string) => ReleaseIntegritySnapshot;
  recordSignal?: typeof recordReleaseIntegritySignal;
  appendAudit?: typeof appendSelfImprovementAuditEvent;
  remediate?: (params: {
    snapshot: ReleaseIntegritySnapshot;
    signal: ReleaseIntegritySignal;
    action: ReleaseIntegrityAction;
    leaseDigest: string;
  }) => Promise<ReleaseIntegrityRemediationResult> | ReleaseIntegrityRemediationResult;
  postApplyProbe?: () => Promise<ReleaseIntegritySnapshot> | ReleaseIntegritySnapshot;
  postApplyQualityCanary?: () => Promise<boolean> | boolean;
};

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const PARENT_IDENTITY_PATTERN = /^[a-f0-9]{40,64}$/u;
const CANDIDATE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,159}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasSafeOwnershipAndMode(filePath: string): boolean {
  const stat = fs.lstatSync(filePath);
  const parent = fs.lstatSync(path.dirname(filePath));
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o777) !== 0o600 ||
    !parent.isDirectory() ||
    parent.isSymbolicLink() ||
    (parent.mode & 0o777) !== 0o700
  ) {
    return false;
  }
  if (typeof process.getuid === "function") {
    return stat.uid === process.getuid() && parent.uid === process.getuid();
  }
  return true;
}

function parseChecks(value: unknown): ReleaseIntegrityChecks | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const keys = [
    "candidateRoot",
    "closure",
    "sourceAvailable",
    "lineageAuthorized",
    "featureParity",
    "performance",
  ] as const;
  if (keys.some((key) => typeof value[key] !== "boolean")) {
    return undefined;
  }
  return Object.fromEntries(keys.map((key) => [key, value[key]])) as ReleaseIntegrityChecks;
}

function parseSnapshot(value: unknown): ReleaseIntegritySnapshot | undefined {
  if (!isRecord(value) || value.version !== 1) {
    return undefined;
  }
  const checks = parseChecks(value.checks);
  if (
    typeof value.candidateId !== "string" ||
    !CANDIDATE_ID_PATTERN.test(value.candidateId) ||
    typeof value.runtimeIdentitySha256 !== "string" ||
    !SHA256_PATTERN.test(value.runtimeIdentitySha256) ||
    typeof value.activeParentRuntimeIdentity !== "string" ||
    !PARENT_IDENTITY_PATTERN.test(value.activeParentRuntimeIdentity) ||
    typeof value.canaryActive !== "boolean" ||
    typeof value.stateSha256 !== "string" ||
    !SHA256_PATTERN.test(value.stateSha256) ||
    !checks
  ) {
    return undefined;
  }
  return {
    version: 1,
    candidateId: value.candidateId,
    runtimeIdentitySha256: value.runtimeIdentitySha256,
    activeParentRuntimeIdentity: value.activeParentRuntimeIdentity,
    canaryActive: value.canaryActive,
    checks,
    stateSha256: value.stateSha256,
  };
}

export function readReleaseIntegritySnapshot(statusPath: string): ReleaseIntegritySnapshot {
  if (!hasSafeOwnershipAndMode(statusPath)) {
    throw new Error("release integrity status must be an owned mode-600 regular file");
  }
  const parsed = parseSnapshot(JSON.parse(fs.readFileSync(statusPath, "utf8")));
  if (!parsed) {
    throw new Error("release integrity status failed schema validation");
  }
  return parsed;
}

function parseLease(value: unknown, now: number): ReleaseIntegrityLease | undefined {
  if (!isRecord(value) || value.version !== 1 || value.governor !== "release-integrity") {
    return undefined;
  }
  const qualityCanary = isRecord(value.qualityCanary) ? value.qualityCanary : undefined;
  const allowedActions = Array.isArray(value.allowedActions) ? value.allowedActions : undefined;
  if (
    typeof value.candidateId !== "string" ||
    !CANDIDATE_ID_PATTERN.test(value.candidateId) ||
    typeof value.runtimeIdentitySha256 !== "string" ||
    !SHA256_PATTERN.test(value.runtimeIdentitySha256) ||
    typeof value.activeParentRuntimeIdentity !== "string" ||
    !PARENT_IDENTITY_PATTERN.test(value.activeParentRuntimeIdentity) ||
    typeof value.expiresAt !== "number" ||
    !Number.isSafeInteger(value.expiresAt) ||
    value.expiresAt <= now ||
    typeof value.evidenceBundleSha256 !== "string" ||
    !SHA256_PATTERN.test(value.evidenceBundleSha256) ||
    !allowedActions ||
    allowedActions.length === 0 ||
    allowedActions.some(
      (action) =>
        typeof action !== "string" ||
        !(RELEASE_INTEGRITY_ACTIONS as readonly string[]).includes(action),
    ) ||
    new Set(allowedActions).size !== allowedActions.length ||
    qualityCanary?.passed !== true ||
    typeof qualityCanary.checkedAt !== "number" ||
    !Number.isSafeInteger(qualityCanary.checkedAt) ||
    qualityCanary.checkedAt > now ||
    now - qualityCanary.checkedAt > 24 * 60 * 60_000
  ) {
    return undefined;
  }
  return {
    version: 1,
    governor: "release-integrity",
    candidateId: value.candidateId,
    runtimeIdentitySha256: value.runtimeIdentitySha256,
    activeParentRuntimeIdentity: value.activeParentRuntimeIdentity,
    expiresAt: value.expiresAt,
    allowedActions: allowedActions as ReleaseIntegrityAction[],
    evidenceBundleSha256: value.evidenceBundleSha256,
    qualityCanary: { passed: true, checkedAt: qualityCanary.checkedAt },
  };
}

function loadLease(leasePath: string, now: number): LoadedLease | undefined {
  try {
    if (!hasSafeOwnershipAndMode(leasePath)) {
      return undefined;
    }
    const bytes = fs.readFileSync(leasePath);
    const lease = parseLease(JSON.parse(bytes.toString("utf8")), now);
    return lease
      ? { lease, digest: crypto.createHash("sha256").update(bytes).digest("hex") }
      : undefined;
  } catch {
    return undefined;
  }
}

export function evaluateReleaseIntegrity(
  snapshot: ReleaseIntegritySnapshot,
): { signal: ReleaseIntegritySignal; candidateActions: ReleaseIntegrityAction[] } | undefined {
  if (!snapshot.checks.candidateRoot) {
    return {
      signal: "release.candidate_root_mismatch",
      candidateActions: ["quarantine-candidate", "rebuild-disposable-candidate"],
    };
  }
  if (!snapshot.checks.closure) {
    return {
      signal: "release.closure_mismatch",
      candidateActions: ["quarantine-candidate", "rebuild-disposable-candidate"],
    };
  }
  if (!snapshot.checks.sourceAvailable) {
    return {
      signal: "release.source_unavailable",
      candidateActions: ["restore-source-capsule", "rebuild-disposable-candidate"],
    };
  }
  if (!snapshot.checks.lineageAuthorized) {
    return {
      signal: "release.lineage_migration_required",
      candidateActions: ["request-lineage-migration", "rerun-verification"],
    };
  }
  if (!snapshot.checks.featureParity) {
    return {
      signal: "release.feature_parity_failed",
      candidateActions: ["quarantine-candidate", "rebuild-disposable-candidate"],
    };
  }
  if (!snapshot.checks.performance) {
    return {
      signal: "release.performance_regression",
      candidateActions: snapshot.canaryActive
        ? ["rollback-canary", "defer-background-work"]
        : ["defer-background-work", "rerun-verification"],
    };
  }
  return undefined;
}

function requestPath(requestDirectory: string, snapshot: ReleaseIntegritySnapshot, action: string) {
  const digest = crypto
    .createHash("sha256")
    .update(`${snapshot.runtimeIdentitySha256}:${snapshot.stateSha256}:${action}`)
    .digest("hex");
  return path.join(requestDirectory, `repair-${digest}.json`);
}

export function writeReleaseIntegrityRepairRequest(params: {
  requestDirectory: string;
  snapshot: ReleaseIntegritySnapshot;
  signal: ReleaseIntegritySignal;
  action: ReleaseIntegrityAction;
  leaseDigest: string;
}): ReleaseIntegrityRemediationResult {
  const directory = path.resolve(params.requestDirectory);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const directoryStat = fs.lstatSync(directory);
  if (
    !directoryStat.isDirectory() ||
    directoryStat.isSymbolicLink() ||
    (directoryStat.mode & 0o777) !== 0o700 ||
    (typeof process.getuid === "function" && directoryStat.uid !== process.getuid())
  ) {
    throw new Error("release repair request directory must be an owned mode-700 directory");
  }
  const filePath = requestPath(directory, params.snapshot, params.action);
  if (!fs.existsSync(filePath)) {
    const temporary = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(
      temporary,
      `${JSON.stringify(
        {
          version: 1,
          candidateId: params.snapshot.candidateId,
          runtimeIdentitySha256: params.snapshot.runtimeIdentitySha256,
          activeParentRuntimeIdentity: params.snapshot.activeParentRuntimeIdentity,
          stateSha256: params.snapshot.stateSha256,
          signal: params.signal,
          action: params.action,
          leaseDigest: params.leaseDigest,
        },
        null,
        2,
      )}\n`,
      { mode: 0o600, flag: "wx" },
    );
    fs.renameSync(temporary, filePath);
  }
  return { applied: false };
}

function snapshotStillFails(snapshot: ReleaseIntegritySnapshot, signal: ReleaseIntegritySignal) {
  return evaluateReleaseIntegrity(snapshot)?.signal === signal;
}

async function auditCycle(params: {
  stateDir: string;
  snapshot: ReleaseIntegritySnapshot;
  signal: ReleaseIntegritySignal;
  action: ReleaseIntegrityAction;
  leaseDigest: string;
  result: ReleaseIntegrityCycleResult["status"];
  postStateSha256?: string;
  rollbackReceiptSha256?: string;
  appendAudit: typeof appendSelfImprovementAuditEvent;
  now: number;
}) {
  await params.appendAudit({
    stateDir: params.stateDir,
    event: {
      createdAt: params.now,
      kind: "production_check",
      actor: "governor",
      targetId: params.snapshot.candidateId,
      summary: `Release integrity remediation ${params.result}: ${params.action}`,
      metadata: {
        signal: params.signal,
        action: params.action,
        runtimeIdentitySha256: params.snapshot.runtimeIdentitySha256,
        preStateSha256: params.snapshot.stateSha256,
        ...(params.postStateSha256 ? { postStateSha256: params.postStateSha256 } : {}),
        ...(params.rollbackReceiptSha256
          ? { rollbackReceiptSha256: params.rollbackReceiptSha256 }
          : {}),
        leaseDigest: params.leaseDigest,
      },
    },
  });
}

export async function runReleaseIntegrityCycle(params: {
  stateDir: string;
  statusPath: string;
  leasePath: string;
  requestDirectory: string;
  deps?: ReleaseIntegrityDeps;
}): Promise<ReleaseIntegrityCycleResult> {
  const deps = params.deps ?? {};
  const now = (deps.now ?? Date.now)();
  let snapshot: ReleaseIntegritySnapshot;
  try {
    snapshot = (deps.readSnapshot ?? readReleaseIntegritySnapshot)(params.statusPath);
  } catch (error) {
    return {
      status: "status-invalid",
      checkedAt: now,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  const finding = evaluateReleaseIntegrity(snapshot);
  if (!finding) {
    return {
      status: "healthy",
      checkedAt: now,
      candidateId: snapshot.candidateId,
      reason: "all release integrity checks passed",
    };
  }
  const loadedLease = loadLease(params.leasePath, now);
  if (
    !loadedLease ||
    loadedLease.lease.candidateId !== snapshot.candidateId ||
    loadedLease.lease.runtimeIdentitySha256 !== snapshot.runtimeIdentitySha256 ||
    loadedLease.lease.activeParentRuntimeIdentity !== snapshot.activeParentRuntimeIdentity
  ) {
    return {
      status: "lease-invalid",
      checkedAt: now,
      signal: finding.signal,
      candidateId: snapshot.candidateId,
      reason: "release integrity lease is absent, stale, or bound to another candidate",
    };
  }
  await (deps.recordSignal ?? recordReleaseIntegritySignal)({
    stateDir: params.stateDir,
    now,
    idempotencyKey: `${finding.signal}:${snapshot.runtimeIdentitySha256}:${snapshot.stateSha256}`,
    title: `Release integrity signal: ${finding.signal}`,
    summary:
      "Release Governor detected a candidate-bound integrity failure and selected a bounded remediation.",
    category:
      finding.signal === "release.performance_regression"
        ? "efficiency_opportunity"
        : "risk_prevention",
    severity: finding.signal === "release.performance_regression" ? "high" : "critical",
    evidence: [
      `candidateId: ${snapshot.candidateId}`,
      `runtimeIdentitySha256: ${snapshot.runtimeIdentitySha256}`,
      `stateSha256: ${snapshot.stateSha256}`,
      `signal: ${finding.signal}`,
    ],
    source: "gateway",
    sourceRef: finding.signal,
  });
  const action = finding.candidateActions.find((candidate) =>
    loadedLease.lease.allowedActions.includes(candidate),
  );
  if (!action) {
    return {
      status: "no-authorized-action",
      checkedAt: now,
      signal: finding.signal,
      candidateId: snapshot.candidateId,
      leaseDigest: loadedLease.digest,
      reason: "lease authorizes no remediation for the detected signal",
    };
  }
  const remediate =
    deps.remediate ??
    ((input) =>
      writeReleaseIntegrityRepairRequest({
        requestDirectory: params.requestDirectory,
        ...input,
      }));
  const remediation = await remediate({
    snapshot,
    signal: finding.signal,
    action,
    leaseDigest: loadedLease.digest,
  });
  if (!remediation.applied) {
    const result: ReleaseIntegrityCycleResult = {
      status: "repair-requested",
      checkedAt: now,
      signal: finding.signal,
      action,
      candidateId: snapshot.candidateId,
      leaseDigest: loadedLease.digest,
      reason: "an identity-bound remediation request was written for the lifecycle coordinator",
    };
    await auditCycle({
      stateDir: params.stateDir,
      snapshot,
      signal: finding.signal,
      action,
      leaseDigest: loadedLease.digest,
      result: result.status,
      appendAudit: deps.appendAudit ?? appendSelfImprovementAuditEvent,
      now,
    });
    return result;
  }
  const postSnapshot = deps.postApplyProbe ? await deps.postApplyProbe() : undefined;
  const qualityPassed = deps.postApplyQualityCanary ? await deps.postApplyQualityCanary() : true;
  if ((postSnapshot && snapshotStillFails(postSnapshot, finding.signal)) || !qualityPassed) {
    let rollbackError: string | undefined;
    try {
      await remediation.rollback?.();
    } catch (error) {
      rollbackError = error instanceof Error ? error.message : String(error);
    }
    const result: ReleaseIntegrityCycleResult = {
      status: "rolled-back",
      checkedAt: now,
      signal: finding.signal,
      action,
      candidateId: snapshot.candidateId,
      leaseDigest: loadedLease.digest,
      reason: qualityPassed
        ? "post-remediation integrity probe still failed; rollback executed"
        : "post-remediation quality canary failed; rollback executed",
      ...(rollbackError ? { rollbackError } : {}),
    };
    await auditCycle({
      stateDir: params.stateDir,
      snapshot,
      signal: finding.signal,
      action,
      leaseDigest: loadedLease.digest,
      result: result.status,
      postStateSha256: remediation.postStateSha256,
      rollbackReceiptSha256: remediation.rollbackReceiptSha256,
      appendAudit: deps.appendAudit ?? appendSelfImprovementAuditEvent,
      now,
    });
    return result;
  }
  const result: ReleaseIntegrityCycleResult = {
    status: "applied",
    checkedAt: now,
    signal: finding.signal,
    action,
    candidateId: snapshot.candidateId,
    leaseDigest: loadedLease.digest,
    reason: "bounded remediation passed its integrity and quality canaries",
  };
  await auditCycle({
    stateDir: params.stateDir,
    snapshot,
    signal: finding.signal,
    action,
    leaseDigest: loadedLease.digest,
    result: result.status,
    postStateSha256: remediation.postStateSha256,
    rollbackReceiptSha256: remediation.rollbackReceiptSha256,
    appendAudit: deps.appendAudit ?? appendSelfImprovementAuditEvent,
    now,
  });
  return result;
}

export function startReleaseIntegritySupervisor(params: {
  stateDir: string;
  statusPath: string;
  leasePath: string;
  requestDirectory: string;
  intervalMs?: number;
  log?: ReleaseIntegrityLog;
}): { stop: () => void; runNow: () => Promise<ReleaseIntegrityCycleResult> } {
  let running: Promise<ReleaseIntegrityCycleResult> | undefined;
  const runNow = () => {
    running ??= runReleaseIntegrityCycle(params).finally(() => {
      running = undefined;
    });
    return running;
  };
  const timer = setInterval(() => {
    void runNow().catch((error: unknown) =>
      params.log?.error(`release integrity supervisor failed: ${String(error)}`),
    );
  }, params.intervalMs ?? RELEASE_INTEGRITY_INTERVAL_MS);
  timer.unref?.();
  void runNow().catch((error: unknown) =>
    params.log?.error(`release integrity supervisor failed: ${String(error)}`),
  );
  return { stop: () => clearInterval(timer), runNow };
}

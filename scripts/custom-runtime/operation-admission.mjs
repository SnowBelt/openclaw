#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REGISTRY_SCHEMA = "openclaw.operation-admission-registry.v1";
const RECEIPT_SCHEMA = "openclaw.operation-admission-receipt.v1";
const LOCK_SCHEMA = "openclaw.operation-admission-lock.v1";
const ACTIVE_STATES = new Set(["admitted", "running", "cleanup_pending"]);
const TERMINAL_STATES = new Set(["completed", "failed", "cancelled"]);
const RESOURCE_CLASSES = new Set([
  "source-worktree",
  "storage-large",
  "local-model",
  "gateway",
  "runtime-config",
  "certification-metadata",
  "managed-runtime-mutation",
  "staging-port",
  "retention-cleanup",
]);
const PRIORITY_RANK = { normal: 0, high: 1, critical: 2 };
const DEFAULT_LOCK_WAIT_MS = 60_000;
const DEFAULT_LOCK_POLL_MS = 50;
const DEFAULT_LOCK_STALE_MS = 30_000;
const DEFAULT_OPERATION_TTL_MS = 4 * 60 * 60 * 1000;
const DEFAULT_WAIT_MS = 5 * 60 * 1000;
const DEFAULT_AGING_MS = 30_000;
const MAX_TERMINAL_OPERATIONS = 128;

export class OperationAdmissionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "OperationAdmissionError";
    this.code = code;
    this.details = details;
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalValue(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .toSorted((left, right) => left.localeCompare(right))
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  throw new TypeError(`Unsupported canonical value: ${String(value)}`);
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function sha256Canonical(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && typeof error === "object" && "code" in error && error.code === "EPERM");
  }
}

function atomicWriteJson(filePath, value) {
  const parent = path.dirname(filePath);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const temporary = path.join(parent, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}`);
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function readJson(filePath) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new OperationAdmissionError("registry_invalid", `Unable to parse ${filePath}.`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (!isRecord(parsed)) {
    throw new OperationAdmissionError("registry_invalid", `Expected an object in ${filePath}.`);
  }
  return parsed;
}

function readRegistry(registryPath) {
  if (!fs.existsSync(registryPath)) {
    return { schema: REGISTRY_SCHEMA, revision: 0, operations: {}, updatedAt: null };
  }
  const registry = readJson(registryPath);
  if (
    registry.schema !== REGISTRY_SCHEMA ||
    !Number.isSafeInteger(registry.revision) ||
    registry.revision < 0 ||
    !isRecord(registry.operations)
  ) {
    throw new OperationAdmissionError(
      "registry_invalid",
      `Operation-admission registry is invalid: ${registryPath}`,
    );
  }
  return registry;
}

function assertIdentity(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:@/+~-]{1,160}$/u.test(value)) {
    throw new OperationAdmissionError("invalid_request", `${label} is invalid.`);
  }
}

function normalizeClaims(claims) {
  if (!Array.isArray(claims) || claims.length === 0) {
    throw new OperationAdmissionError(
      "invalid_request",
      "At least one resource claim is required.",
    );
  }
  const normalized = claims.map((claim) => {
    if (!isRecord(claim) || !RESOURCE_CLASSES.has(claim.resource)) {
      throw new OperationAdmissionError("invalid_request", "Resource claim class is invalid.");
    }
    if (claim.mode !== "shared" && claim.mode !== "exclusive") {
      throw new OperationAdmissionError("invalid_request", "Resource claim mode is invalid.");
    }
    const key = typeof claim.key === "string" && claim.key ? claim.key : "default";
    assertIdentity(key, "Resource claim key");
    return { resource: claim.resource, key, mode: claim.mode };
  });
  const unique = new Map();
  for (const claim of normalized) {
    const id = `${claim.resource}:${claim.key}`;
    const existing = unique.get(id);
    if (!existing || claim.mode === "exclusive") {
      unique.set(id, claim);
    }
  }
  return [...unique.values()].toSorted((left, right) =>
    `${left.resource}:${left.key}`.localeCompare(`${right.resource}:${right.key}`),
  );
}

function claimsConflict(leftClaims, rightClaims) {
  for (const left of leftClaims) {
    for (const right of rightClaims) {
      if (
        left.resource === right.resource &&
        left.key === right.key &&
        (left.mode === "exclusive" || right.mode === "exclusive")
      ) {
        return true;
      }
    }
  }
  return false;
}

function operationSortKey(operation, nowMs, agingMs) {
  const enqueuedAt = Date.parse(operation.enqueuedAt);
  const ageSteps = Math.max(0, Math.floor((nowMs - enqueuedAt) / agingMs));
  const rank = Math.min(2, (PRIORITY_RANK[operation.priority] ?? 0) + ageSteps);
  return { rank, enqueuedAt, operationId: operation.operationId };
}

function compareQueued(left, right, nowMs, agingMs) {
  const leftKey = operationSortKey(left, nowMs, agingMs);
  const rightKey = operationSortKey(right, nowMs, agingMs);
  return (
    rightKey.rank - leftKey.rank ||
    leftKey.enqueuedAt - rightKey.enqueuedAt ||
    leftKey.operationId.localeCompare(rightKey.operationId)
  );
}

function appendTransition(operation, state, nowMs, reason) {
  operation.state = state;
  operation.updatedAt = new Date(nowMs).toISOString();
  if (reason) {
    operation.reason = reason;
  }
  operation.transitions ??= [];
  operation.transitions.push({ state, at: operation.updatedAt, ...(reason ? { reason } : {}) });
  operation.transitions = operation.transitions.slice(-32);
}

function operationNeedsCleanup(operation) {
  return (
    operation.workspacePaths?.length > 0 ||
    operation.claims.some((claim) => claim.resource === "storage-large")
  );
}

function recoverStaleOperations(registry, nowMs, pidIsAlive) {
  for (const operation of Object.values(registry.operations)) {
    if (!isRecord(operation) || !ACTIVE_STATES.has(operation.state)) {
      continue;
    }
    const heartbeatExpired = Date.parse(operation.expiresAt) <= nowMs;
    const ownerExited = !pidIsAlive(operation.pid);
    if (!heartbeatExpired && !ownerExited) {
      continue;
    }
    const reason = heartbeatExpired ? "heartbeat_expired" : "owner_process_exited";
    appendTransition(
      operation,
      operationNeedsCleanup(operation) ? "cleanup_pending" : "failed",
      nowMs,
      reason,
    );
    operation.finishedAt = operation.state === "failed" ? operation.updatedAt : null;
  }
}

function grantQueuedOperations(registry, nowMs, agingMs) {
  const active = Object.values(registry.operations).filter(
    (operation) => isRecord(operation) && ACTIVE_STATES.has(operation.state),
  );
  const queued = Object.values(registry.operations)
    .filter((operation) => isRecord(operation) && operation.state === "queued")
    .toSorted((left, right) => compareQueued(left, right, nowMs, agingMs));
  const bypassBarriers = [];
  for (const operation of queued) {
    const conflictsWithActive = active.some((entry) =>
      claimsConflict(operation.claims, entry.claims),
    );
    const bypassesOlderWaiter = bypassBarriers.some((claims) =>
      claimsConflict(operation.claims, claims),
    );
    if (conflictsWithActive || bypassesOlderWaiter) {
      bypassBarriers.push(operation.claims);
      continue;
    }
    appendTransition(operation, "admitted", nowMs, "resources_admitted");
    operation.admittedAt = operation.updatedAt;
    operation.heartbeatAt = operation.updatedAt;
    active.push(operation);
  }
}

function trimTerminalOperations(registry) {
  const terminal = Object.values(registry.operations)
    .filter((operation) => isRecord(operation) && TERMINAL_STATES.has(operation.state))
    .toSorted((left, right) => String(right.finishedAt).localeCompare(String(left.finishedAt)));
  for (const operation of terminal.slice(MAX_TERMINAL_OPERATIONS)) {
    delete registry.operations[operation.operationId];
  }
}

function receiptDirectory(registryPath) {
  return path.join(path.dirname(registryPath), "operation-admission-receipts");
}

function writeReceipt(registryPath, operation, event, nowMs) {
  const payload = {
    schema: RECEIPT_SCHEMA,
    event,
    at: new Date(nowMs).toISOString(),
    operation: structuredClone(operation),
  };
  const receipt = { ...payload, receiptSha256: sha256Canonical(payload) };
  const directory = receiptDirectory(registryPath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const target = path.join(
    directory,
    `${new Date(nowMs).toISOString().replaceAll(/[:.]/gu, "")}-${operation.operationId}-${event}-${randomUUID()}.json`,
  );
  atomicWriteJson(target, receipt);
  return { path: target, sha256: receipt.receiptSha256 };
}

function readLockOwner(lockDir) {
  const ownerPath = path.join(lockDir, "owner.json");
  let owner;
  try {
    owner = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw new OperationAdmissionError(
      "registry_invalid",
      `Unable to parse operation-admission lock owner: ${ownerPath}`,
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
  if (
    !isRecord(owner) ||
    owner.schema !== LOCK_SCHEMA ||
    !Number.isSafeInteger(owner.pid) ||
    owner.pid <= 0 ||
    typeof owner.token !== "string" ||
    !owner.token ||
    typeof owner.createdAt !== "string" ||
    !Number.isFinite(Date.parse(owner.createdAt))
  ) {
    throw new OperationAdmissionError(
      "registry_invalid",
      `Operation-admission lock owner is invalid: ${ownerPath}`,
    );
  }
  return {
    schema: owner.schema,
    pid: owner.pid,
    token: owner.token,
    createdAt: owner.createdAt,
  };
}

async function acquireRegistryLock({
  registryPath,
  waitMs = DEFAULT_LOCK_WAIT_MS,
  pollMs = DEFAULT_LOCK_POLL_MS,
  staleMs = DEFAULT_LOCK_STALE_MS,
  pidIsAlive = processIsAlive,
}) {
  const lockDir = `${registryPath}.lock`;
  const startedAt = Date.now();
  for (;;) {
    let candidateDir;
    try {
      fs.mkdirSync(path.dirname(registryPath), { recursive: true, mode: 0o700 });
      const token = randomUUID();
      candidateDir = `${lockDir}.candidate-${process.pid}-${token}`;
      fs.mkdirSync(candidateDir, { mode: 0o700 });
      const owner = {
        schema: LOCK_SCHEMA,
        pid: process.pid,
        token,
        createdAt: new Date().toISOString(),
      };
      try {
        atomicWriteJson(path.join(candidateDir, "owner.json"), owner);
        fs.renameSync(candidateDir, lockDir);
        candidateDir = undefined;
      } catch (error) {
        fs.rmSync(candidateDir, { recursive: true, force: true });
        throw error;
      }
      return () => {
        const current = readLockOwner(lockDir);
        if (current?.token === token) {
          const releasedDir = `${lockDir}.released-${process.pid}-${token}`;
          try {
            fs.renameSync(lockDir, releasedDir);
          } catch (error) {
            if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
              return;
            }
            throw error;
          }
          const releasedOwner = readLockOwner(releasedDir);
          if (releasedOwner?.token !== token) {
            throw new OperationAdmissionError(
              "ownership_lost",
              `Registry lock ownership changed before release: ${lockDir}`,
            );
          }
          fs.rmSync(releasedDir, { recursive: true, force: true });
        }
      };
    } catch (error) {
      if (candidateDir) {
        fs.rmSync(candidateDir, { recursive: true, force: true });
      }
      if (
        !error ||
        typeof error !== "object" ||
        !("code" in error) ||
        !["EEXIST", "ENOTEMPTY"].includes(error.code)
      ) {
        throw error;
      }
      const owner = readLockOwner(lockDir);
      let stat;
      try {
        stat = fs.statSync(lockDir);
      } catch {
        continue;
      }
      const ageMs = Date.now() - stat.mtimeMs;
      const stale = owner ? ageMs >= staleMs && !pidIsAlive(owner.pid) : ageMs >= 250;
      if (stale) {
        const quarantine = `${lockDir}.recovered-${Date.now()}-${randomUUID()}`;
        try {
          fs.renameSync(lockDir, quarantine);
          fs.rmSync(quarantine, { recursive: true, force: true });
          const recovery = {
            schema: RECEIPT_SCHEMA,
            event: "registry_lock_recovered",
            at: new Date().toISOString(),
            previousOwner: owner,
          };
          const receipt = { ...recovery, receiptSha256: sha256Canonical(recovery) };
          fs.mkdirSync(receiptDirectory(registryPath), { recursive: true, mode: 0o700 });
          atomicWriteJson(
            path.join(
              receiptDirectory(registryPath),
              `registry-lock-recovered-${randomUUID()}.json`,
            ),
            receipt,
          );
          continue;
        } catch (recoveryError) {
          if (
            recoveryError &&
            typeof recoveryError === "object" &&
            "code" in recoveryError &&
            ["ENOENT", "EEXIST"].includes(recoveryError.code)
          ) {
            continue;
          }
          throw recoveryError;
        }
      }
      if (Date.now() - startedAt >= waitMs) {
        throw new OperationAdmissionError("registry_busy", `Timed out waiting for ${lockDir}.`, {
          lockDir,
          owner,
        });
      }
      await sleep(pollMs);
    }
  }
}

async function transaction(registryPath, callback, options = {}) {
  const release = await acquireRegistryLock({ registryPath, ...options });
  try {
    const registry = readRegistry(registryPath);
    const nowMs = options.nowMs ?? Date.now();
    recoverStaleOperations(registry, nowMs, options.pidIsAlive ?? processIsAlive);
    grantQueuedOperations(registry, nowMs, options.agingMs ?? DEFAULT_AGING_MS);
    const result = await callback(registry, nowMs);
    grantQueuedOperations(registry, nowMs, options.agingMs ?? DEFAULT_AGING_MS);
    trimTerminalOperations(registry);
    registry.revision += 1;
    registry.updatedAt = new Date(nowMs).toISOString();
    atomicWriteJson(registryPath, registry);
    return result;
  } finally {
    release();
  }
}

function publicOperation(operation, registryPath) {
  return { ...structuredClone(operation), registryPath };
}

export async function acquireOperation({
  registryPath,
  operationId,
  invocationId,
  taskId,
  owner,
  claims,
  priority = "normal",
  pid = process.pid,
  ttlMs = DEFAULT_OPERATION_TTL_MS,
  waitMs = DEFAULT_WAIT_MS,
  persistOnTimeout = false,
  expectedBytes = 0,
  expectedMemoryBytes = 0,
  candidateIdentity = null,
  activeRuntimeIdentity = null,
  onWait,
  ...options
}) {
  const resolvedRegistryPath = path.resolve(registryPath);
  for (const [value, label] of [
    [operationId, "Operation identity"],
    [invocationId, "Invocation identity"],
    [taskId, "Task identity"],
    [owner, "Owner identity"],
  ]) {
    assertIdentity(value, label);
  }
  if (!(priority in PRIORITY_RANK)) {
    throw new OperationAdmissionError("invalid_request", "Priority is invalid.");
  }
  if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new OperationAdmissionError("invalid_request", "PID or TTL is invalid.");
  }
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0) {
    throw new OperationAdmissionError("invalid_request", "Expected storage is invalid.");
  }
  if (!Number.isSafeInteger(expectedMemoryBytes) || expectedMemoryBytes < 0) {
    throw new OperationAdmissionError("invalid_request", "Expected memory is invalid.");
  }
  const normalizedClaims = normalizeClaims(claims);
  const ownerToken = randomUUID();
  const enqueued = await transaction(
    resolvedRegistryPath,
    (registry, nowMs) => {
      const existing = registry.operations[operationId];
      if (existing) {
        if (existing.invocationId !== invocationId || existing.taskId !== taskId) {
          throw new OperationAdmissionError(
            "identity_conflict",
            `Operation identity is already bound: ${operationId}`,
          );
        }
        if (TERMINAL_STATES.has(existing.state)) {
          throw new OperationAdmissionError(
            "operation_terminal",
            `Operation already finished with state ${existing.state}.`,
          );
        }
        return publicOperation(existing, resolvedRegistryPath);
      }
      const at = new Date(nowMs).toISOString();
      const operation = {
        operationId,
        invocationId,
        taskId,
        owner,
        ownerToken,
        pid,
        priority,
        claims: normalizedClaims,
        expectedBytes,
        expectedMemoryBytes,
        candidateIdentity,
        activeRuntimeIdentity,
        workspacePaths: [],
        state: "queued",
        enqueuedAt: at,
        updatedAt: at,
        heartbeatAt: at,
        expiresAt: new Date(nowMs + ttlMs).toISOString(),
        transitions: [{ state: "queued", at }],
      };
      registry.operations[operationId] = operation;
      writeReceipt(resolvedRegistryPath, operation, "queued", nowMs);
      return publicOperation(operation, resolvedRegistryPath);
    },
    options,
  );
  const token = enqueued.ownerToken;
  const startedAt = Date.now();
  let announced = false;
  for (;;) {
    const current = await transaction(
      resolvedRegistryPath,
      (registry) => {
        const operation = registry.operations[operationId];
        if (!isRecord(operation) || operation.ownerToken !== token) {
          throw new OperationAdmissionError(
            "ownership_lost",
            `Operation ownership was lost: ${operationId}`,
          );
        }
        return publicOperation(operation, resolvedRegistryPath);
      },
      options,
    );
    if (current.state === "admitted" || current.state === "running") {
      if (current.state === "admitted") {
        return markOperationRunning({ operation: current, ...options });
      }
      return current;
    }
    if (current.state !== "queued") {
      throw new OperationAdmissionError(
        "operation_unavailable",
        `Operation cannot be admitted from state ${current.state}.`,
      );
    }
    if (!announced) {
      onWait?.(current);
      announced = true;
    }
    if (Date.now() - startedAt >= waitMs) {
      if (persistOnTimeout) {
        return current;
      }
      await cancelOperation({
        operation: current,
        reason: "admission_deadline_exceeded",
        ...options,
      });
      throw new OperationAdmissionError(
        "deadline_exceeded",
        `Timed out waiting for operation admission: ${operationId}`,
      );
    }
    await sleep(options.pollMs ?? DEFAULT_LOCK_POLL_MS);
  }
}

export async function markOperationRunning({ operation, ...options }) {
  return transaction(
    operation.registryPath,
    (registry, nowMs) => {
      const current = assertOwnedOperation(registry, operation, new Set(["admitted", "running"]));
      if (current.state === "admitted") {
        appendTransition(current, "running", nowMs, "owner_started");
        writeReceipt(operation.registryPath, current, "running", nowMs);
      }
      return publicOperation(current, operation.registryPath);
    },
    options,
  );
}

function assertOwnedOperation(registry, operation, allowedStates) {
  const current = registry.operations[operation.operationId];
  if (!isRecord(current) || current.ownerToken !== operation.ownerToken) {
    throw new OperationAdmissionError(
      "ownership_lost",
      `Operation ownership was lost: ${operation.operationId}`,
    );
  }
  if (!allowedStates.has(current.state)) {
    throw new OperationAdmissionError(
      "invalid_state",
      `Operation ${operation.operationId} is ${current.state}; expected ${[...allowedStates].join(", ")}.`,
    );
  }
  return current;
}

export async function heartbeatOperation({
  operation,
  ttlMs = DEFAULT_OPERATION_TTL_MS,
  ...options
}) {
  return transaction(
    operation.registryPath,
    (registry, nowMs) => {
      const current = assertOwnedOperation(registry, operation, new Set(["admitted", "running"]));
      current.heartbeatAt = new Date(nowMs).toISOString();
      current.expiresAt = new Date(
        Math.max(Date.parse(current.expiresAt), nowMs + ttlMs),
      ).toISOString();
      current.updatedAt = current.heartbeatAt;
      return publicOperation(current, operation.registryPath);
    },
    options,
  );
}

export async function registerOperationWorkspace({ operation, workspacePath, ...options }) {
  const resolved = path.resolve(workspacePath);
  return transaction(
    operation.registryPath,
    (registry, nowMs) => {
      const current = assertOwnedOperation(registry, operation, new Set(["admitted", "running"]));
      if (!current.claims.some((claim) => claim.resource === "storage-large")) {
        throw new OperationAdmissionError(
          "invalid_request",
          "Workspace registration requires a storage-large claim.",
        );
      }
      if (!current.workspacePaths.includes(resolved)) {
        current.workspacePaths.push(resolved);
        current.workspacePaths.sort((left, right) => left.localeCompare(right));
      }
      current.updatedAt = new Date(nowMs).toISOString();
      return publicOperation(current, operation.registryPath);
    },
    options,
  );
}

function normalizeRuntimeIdentity(value, label) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value !== "string" || !/^[a-f0-9]{40,64}$/iu.test(value)) {
    throw new OperationAdmissionError("invalid_request", `${label} is invalid.`);
  }
  return value.toLowerCase();
}

export async function updateOperationBindings({
  operation,
  candidateIdentity,
  activeRuntimeIdentity,
  ...options
}) {
  const normalizedCandidate = normalizeRuntimeIdentity(candidateIdentity, "Candidate identity");
  const normalizedActive = normalizeRuntimeIdentity(
    activeRuntimeIdentity,
    "Active runtime identity",
  );
  return transaction(
    operation.registryPath,
    (registry, nowMs) => {
      const current = assertOwnedOperation(registry, operation, new Set(["admitted", "running"]));
      for (const [field, value] of [
        ["candidateIdentity", normalizedCandidate],
        ["activeRuntimeIdentity", normalizedActive],
      ]) {
        if (!value) {
          continue;
        }
        if (current[field] && current[field] !== value) {
          throw new OperationAdmissionError(
            "identity_conflict",
            `Operation ${field} changed after admission.`,
          );
        }
        current[field] = value;
      }
      current.updatedAt = new Date(nowMs).toISOString();
      return publicOperation(current, operation.registryPath);
    },
    options,
  );
}

export async function finishOperation({
  operation,
  state = "completed",
  reason = "completed",
  ...options
}) {
  if (state !== "completed" && state !== "failed") {
    throw new OperationAdmissionError("invalid_request", "Terminal operation state is invalid.");
  }
  return transaction(
    operation.registryPath,
    (registry, nowMs) => {
      const current = assertOwnedOperation(
        registry,
        operation,
        new Set(["queued", "admitted", "running", "cleanup_pending"]),
      );
      appendTransition(current, state, nowMs, reason);
      current.finishedAt = current.updatedAt;
      const receipt = writeReceipt(operation.registryPath, current, state, nowMs);
      return { ...publicOperation(current, operation.registryPath), receipt };
    },
    options,
  );
}

export async function cancelOperation({ operation, reason = "cancelled", ...options }) {
  return transaction(
    operation.registryPath,
    (registry, nowMs) => {
      const current = assertOwnedOperation(registry, operation, new Set(["queued", "admitted"]));
      appendTransition(current, "cancelled", nowMs, reason);
      current.finishedAt = current.updatedAt;
      const receipt = writeReceipt(operation.registryPath, current, "cancelled", nowMs);
      return { ...publicOperation(current, operation.registryPath), receipt };
    },
    options,
  );
}

export async function recoverOperation({
  registryPath,
  operationId,
  recoveryApprovalId,
  disposition = "failed",
  reason,
  ...options
}) {
  assertIdentity(operationId, "Operation identity");
  assertIdentity(recoveryApprovalId, "Recovery approval identity");
  assertIdentity(reason, "Recovery reason");
  if (disposition !== "failed" && disposition !== "completed") {
    throw new OperationAdmissionError("invalid_request", "Recovery disposition is invalid.");
  }
  const resolvedRegistryPath = path.resolve(registryPath);
  return transaction(
    resolvedRegistryPath,
    (registry, nowMs) => {
      const current = registry.operations[operationId];
      if (!isRecord(current) || current.state !== "cleanup_pending") {
        throw new OperationAdmissionError(
          "invalid_state",
          `Operation ${operationId} is not pending cleanup.`,
        );
      }
      current.recoveryApprovalId = recoveryApprovalId;
      appendTransition(current, disposition, nowMs, reason);
      current.finishedAt = current.updatedAt;
      const receipt = writeReceipt(resolvedRegistryPath, current, "recovered", nowMs);
      return { ...publicOperation(current, resolvedRegistryPath), receipt };
    },
    options,
  );
}

export async function getOperationSnapshot({ registryPath, ...options }) {
  const resolvedRegistryPath = path.resolve(registryPath);
  return transaction(resolvedRegistryPath, (registry) => structuredClone(registry), options);
}

function parseCli(argv) {
  const [command, ...rest] = argv;
  const values = { command, claims: [] };
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      throw new OperationAdmissionError("invalid_request", `Invalid argument: ${flag ?? ""}`);
    }
    index += 1;
    const name = flag.slice(2);
    if (name === "claim") {
      const [resource, key = "default", mode = "exclusive"] = value.split(":");
      values.claims.push({ resource, key, mode });
    } else {
      values[name] = value;
    }
  }
  return values;
}

async function runCli() {
  const input = parseCli(process.argv.slice(2));
  if (input.command === "status") {
    const snapshot = await getOperationSnapshot({ registryPath: input.registry });
    process.stdout.write(`${JSON.stringify(snapshot)}\n`);
    return;
  }
  if (input.command === "acquire") {
    const operation = await acquireOperation({
      registryPath: input.registry,
      operationId: input["operation-id"],
      invocationId: input["invocation-id"],
      taskId: input["task-id"],
      owner: input.owner,
      claims: input.claims,
      priority: input.priority ?? "normal",
      pid: Number(input.pid ?? process.pid),
      ttlMs: Number(input["ttl-ms"] ?? DEFAULT_OPERATION_TTL_MS),
      waitMs: Number(input["wait-ms"] ?? DEFAULT_WAIT_MS),
      persistOnTimeout: input["persist-on-timeout"] === "true",
      onWait: () => process.stderr.write("operation admission: waiting for shared resources\n"),
    });
    process.stdout.write(`${JSON.stringify(operation)}\n`);
    if (operation.state === "queued") {
      process.exitCode = 75;
    }
    return;
  }
  if (input.command === "recover") {
    const result = await recoverOperation({
      registryPath: input.registry,
      operationId: input["operation-id"],
      recoveryApprovalId: input["approval-id"],
      disposition: input.disposition ?? "failed",
      reason: input.reason,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  const operation = {
    registryPath: path.resolve(input.registry),
    operationId: input["operation-id"],
    ownerToken: input.token,
  };
  if (input.command === "heartbeat") {
    const result = await heartbeatOperation({
      operation,
      ttlMs: Number(input["ttl-ms"] ?? DEFAULT_OPERATION_TTL_MS),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (input.command === "heartbeat-loop") {
    const intervalMs = Number(input["interval-ms"] ?? 30_000);
    const ttlMs = Number(input["ttl-ms"] ?? DEFAULT_OPERATION_TTL_MS);
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 100 || intervalMs > ttlMs) {
      throw new OperationAdmissionError("invalid_request", "Heartbeat interval is invalid.");
    }
    await new Promise((resolve, reject) => {
      let heartbeatRunning = false;
      const timer = setInterval(() => {
        if (heartbeatRunning) {
          return;
        }
        heartbeatRunning = true;
        void heartbeatOperation({ operation, ttlMs })
          .catch((error) => {
            clearInterval(timer);
            reject(error);
          })
          .finally(() => {
            heartbeatRunning = false;
          });
      }, intervalMs);
      const stop = () => {
        clearInterval(timer);
        resolve(undefined);
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    });
    return;
  }
  if (input.command === "workspace") {
    const result = await registerOperationWorkspace({
      operation,
      workspacePath: input.path,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (input.command === "bind") {
    const result = await updateOperationBindings({
      operation,
      candidateIdentity: input["candidate-identity"],
      activeRuntimeIdentity: input["active-runtime-identity"],
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (input.command === "finish") {
    const result = await finishOperation({
      operation,
      state: input.state ?? "completed",
      reason: input.reason ?? "completed",
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  throw new OperationAdmissionError("invalid_request", `Unknown command: ${input.command ?? ""}`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    const code = error instanceof OperationAdmissionError ? error.code : "internal_error";
    process.stderr.write(
      `${JSON.stringify({ code, message: error instanceof Error ? error.message : String(error) })}\n`,
    );
    process.exitCode = code === "deadline_exceeded" || code === "registry_busy" ? 75 : 78;
  });
}

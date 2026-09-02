#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const GIB = 1024 ** 3;
export const DEFAULT_STORAGE_FLOOR_BYTES = 150 * GIB;
export const DEFAULT_STORAGE_TARGET_BYTES = 200 * GIB;
export const DEFAULT_EXPECTED_WORKSPACE_BYTES = 24 * GIB;
export const DEFAULT_MAX_CONCURRENT_WORKSPACES = 1;
export const DEFAULT_RESERVATION_TTL_MS = 12 * 60 * 60 * 1000;

const REGISTRY_SCHEMA = "openclaw.temp-workspace-registry.v1";
const RECEIPT_SCHEMA = "openclaw.disposable-cleanup-receipt.v1";
const TERMINAL_STATES = new Set(["released", "failed", "expired"]);
const REGISTRY_LOCK_STALE_MS = 30_000;
const REGISTRY_LOCK_WAIT_MS = 60_000;
const MACOS_DATA_VOLUME = "/System/Volumes/Data";

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
  throw new Error(`Unsupported canonical value: ${String(value)}`);
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function asError(value, fallback) {
  if (value instanceof Error) {
    return value;
  }
  if (typeof value === "string") {
    return new Error(value);
  }
  return new Error(fallback);
}

export function sha256Canonical(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function defaultRegistryPath() {
  return path.join(os.homedir(), ".openclaw-custom-runtime", "temp-workspace-registry.json");
}

function readJson(filePath) {
  const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!isRecord(value)) {
    throw new Error(`Expected a JSON object in ${filePath}.`);
  }
  return value;
}

function atomicWriteJson(filePath, value) {
  const parent = path.dirname(filePath);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const temporary = path.join(parent, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}`);
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  fs.renameSync(temporary, filePath);
}

function readRegistry(registryPath) {
  if (!fs.existsSync(registryPath)) {
    return { schema: REGISTRY_SCHEMA, reservations: {}, updatedAt: null };
  }
  const registry = readJson(registryPath);
  if (registry.schema !== REGISTRY_SCHEMA || !isRecord(registry.reservations)) {
    throw new Error(`Temporary-workspace registry schema is invalid: ${registryPath}`);
  }
  return registry;
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

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function withRegistryLock(registryPath, operation) {
  const parent = path.dirname(registryPath);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const lockPath = `${registryPath}.lock`;
  const ownerToken = randomUUID();
  const deadline = Date.now() + REGISTRY_LOCK_WAIT_MS;
  let descriptor;
  while (descriptor === undefined) {
    try {
      descriptor = fs.openSync(lockPath, "wx", 0o600);
      fs.writeFileSync(
        descriptor,
        `${JSON.stringify({ pid: process.pid, ownerToken, acquiredAt: new Date().toISOString() })}\n`,
      );
      fs.fsyncSync(descriptor);
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) {
        throw error;
      }
      let owner;
      let lockStat;
      try {
        lockStat = fs.lstatSync(lockPath);
        if (!lockStat.isFile() || lockStat.isSymbolicLink()) {
          throw new Error(`Temporary-workspace registry lock is unsafe: ${lockPath}`, {
            cause: error,
          });
        }
        owner = readJson(lockPath);
        if (
          !Number.isSafeInteger(owner.pid) ||
          owner.pid <= 0 ||
          typeof owner.ownerToken !== "string" ||
          !owner.ownerToken ||
          typeof owner.acquiredAt !== "string" ||
          !Number.isFinite(Date.parse(owner.acquiredAt))
        ) {
          throw new Error(`Temporary-workspace registry lock owner is invalid: ${lockPath}`, {
            cause: error,
          });
        }
      } catch (lockError) {
        if (
          lockError &&
          typeof lockError === "object" &&
          "code" in lockError &&
          lockError.code === "ENOENT"
        ) {
          continue;
        }
        throw new Error(`Temporary-workspace registry lock is unreadable: ${lockPath}`, {
          cause: lockError,
        });
      }
      const stale =
        Date.now() - lockStat.mtimeMs > REGISTRY_LOCK_STALE_MS || !processIsAlive(owner.pid);
      if (stale) {
        const recoveredPath = `${lockPath}.recovered.${process.pid}.${randomUUID()}`;
        try {
          fs.renameSync(lockPath, recoveredPath);
          fs.rmSync(recoveredPath, { force: true });
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
      if (Date.now() >= deadline) {
        throw new Error(`Temporary-workspace registry remained busy: ${lockPath}`, {
          cause: error,
        });
      }
      sleepSync(25);
    }
  }
  let result;
  let operationError;
  try {
    result = operation();
  } catch (error) {
    operationError = error;
  }
  let cleanupError;
  try {
    fs.closeSync(descriptor);
    const current = readJson(lockPath);
    if (current.ownerToken === ownerToken && current.pid === process.pid) {
      fs.unlinkSync(lockPath);
    }
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      cleanupError = error;
    }
  }
  if (operationError) {
    throw asError(operationError, "Temporary-workspace operation failed.");
  }
  if (cleanupError) {
    throw asError(cleanupError, "Temporary-workspace cleanup failed.");
  }
  return result;
}

function operationAdmissionScript() {
  const configured = process.env.OPENCLAW_OPERATION_ADMISSION_BIN;
  const candidate =
    configured ||
    path.join(path.dirname(fileURLToPath(import.meta.url)), "operation-admission.mjs");
  if (!fs.existsSync(candidate) || fs.lstatSync(candidate).isSymbolicLink()) {
    throw new Error(`Operation admission coordinator is unavailable: ${candidate}`);
  }
  return fs.realpathSync(candidate);
}

function runOperationAdmission(args, { timeout = 310_000 } = {}) {
  const result = spawnSync(process.execPath, [operationAdmissionScript(), ...args], {
    encoding: "utf8",
    timeout,
  });
  if (result.status !== 0) {
    throw new Error(
      `Shared operation admission failed (${result.status ?? "signal"}): ${result.stderr.trim()}`,
    );
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error("Shared operation admission returned malformed ownership data.", {
      cause: error,
    });
  }
}

function finishStorageOperation(reservation, state, reason) {
  if (!reservation.operationAdmission) {
    return;
  }
  runOperationAdmission(
    [
      "finish",
      "--registry",
      reservation.operationAdmission.registryPath,
      "--operation-id",
      reservation.operationAdmission.operationId,
      "--token",
      reservation.operationAdmission.ownerToken,
      "--state",
      state,
      "--reason",
      reason,
    ],
    { timeout: 30_000 },
  );
}

function validatePositiveInteger(value, label, { allowZero = false } = {}) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new Error(`${label} must be ${allowZero ? "a non-negative" : "a positive"} integer.`);
  }
}

function assertNonEmpty(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
}

function containedPath(root, candidate) {
  const relative = path.relative(root, candidate);
  return candidate !== root && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function resolveFuturePath(candidate) {
  const absolute = path.resolve(candidate);
  const parent = fs.realpathSync(path.dirname(absolute));
  return path.join(parent, path.basename(absolute));
}

function normalizeAllowedRoots(allowedRoots) {
  if (!Array.isArray(allowedRoots) || allowedRoots.length === 0) {
    throw new Error("Temporary-workspace admission requires at least one allowed root.");
  }
  return [...new Set(allowedRoots.map((root) => fs.realpathSync(path.resolve(root))))].toSorted(
    (left, right) => left.localeCompare(right),
  );
}

function expireStaleReservations(registry, nowMs, pidIsAlive) {
  for (const reservation of Object.values(registry.reservations)) {
    if (!isRecord(reservation) || reservation.state !== "active") {
      continue;
    }
    const expired = Date.parse(String(reservation.expiresAt)) <= nowMs;
    if (expired || !pidIsAlive(reservation.pid)) {
      reservation.state = "expired";
      reservation.finishedAt = new Date(nowMs).toISOString();
      reservation.outcome = expired ? "lease-expired" : "owner-process-exited";
    }
  }
}

function trimTerminalReservations(registry, keep = 64) {
  const terminal = Object.values(registry.reservations)
    .filter((entry) => isRecord(entry) && TERMINAL_STATES.has(entry.state))
    .toSorted((left, right) =>
      String(right.finishedAt ?? right.createdAt).localeCompare(
        String(left.finishedAt ?? left.createdAt),
      ),
    );
  for (const entry of terminal.slice(keep)) {
    delete registry.reservations[entry.id];
  }
}

export function defaultStorageVolumePath(allowedRoots = []) {
  return process.platform === "darwin" && fs.existsSync(MACOS_DATA_VOLUME)
    ? MACOS_DATA_VOLUME
    : path.resolve(allowedRoots[0] ?? process.cwd());
}

export function availableBytes(volumePath = defaultStorageVolumePath()) {
  const stat = fs.statfsSync(volumePath);
  return stat.bavail * stat.bsize;
}

export function acquireStorageReservation({
  owner,
  taskId,
  purpose,
  allowedRoots,
  registryPath = defaultRegistryPath(),
  volumePath,
  expectedBytes = DEFAULT_EXPECTED_WORKSPACE_BYTES,
  floorBytes = DEFAULT_STORAGE_FLOOR_BYTES,
  targetBytes = DEFAULT_STORAGE_TARGET_BYTES,
  maxConcurrent = DEFAULT_MAX_CONCURRENT_WORKSPACES,
  ttlMs = DEFAULT_RESERVATION_TTL_MS,
  nowMs = Date.now(),
  pid = process.pid,
  availableBytesProvider = availableBytes,
  pidIsAlive = processIsAlive,
  operationWaitMs = 300_000,
}) {
  assertNonEmpty(owner, "owner");
  assertNonEmpty(taskId, "taskId");
  assertNonEmpty(purpose, "purpose");
  validatePositiveInteger(expectedBytes, "expectedBytes", { allowZero: true });
  validatePositiveInteger(floorBytes, "floorBytes", { allowZero: true });
  validatePositiveInteger(targetBytes, "targetBytes", { allowZero: true });
  if (targetBytes < floorBytes) {
    throw new Error("targetBytes must be greater than or equal to floorBytes.");
  }
  validatePositiveInteger(maxConcurrent, "maxConcurrent");
  validatePositiveInteger(ttlMs, "ttlMs");
  validatePositiveInteger(pid, "pid");
  const normalizedRoots = normalizeAllowedRoots(allowedRoots);
  const resolvedVolumePath = path.resolve(volumePath ?? defaultStorageVolumePath(normalizedRoots));
  validatePositiveInteger(operationWaitMs, "operationWaitMs", { allowZero: true });
  return withRegistryLock(registryPath, () => {
    const registry = readRegistry(registryPath);
    expireStaleReservations(registry, nowMs, pidIsAlive);
    const active = Object.values(registry.reservations).filter(
      (entry) => isRecord(entry) && entry.state === "active",
    );
    if (active.length >= maxConcurrent) {
      throw new Error(
        `Storage admission denied: ${active.length} temporary workspace operation(s) active; ` +
          `limit is ${maxConcurrent}.`,
      );
    }
    const freeBytes = availableBytesProvider(resolvedVolumePath);
    validatePositiveInteger(freeBytes, "availableBytes", { allowZero: true });
    const reservedBytes = active.reduce(
      (total, entry) => total + Number(entry.expectedBytes ?? 0),
      0,
    );
    const projectedFreeBytes = freeBytes - reservedBytes - expectedBytes;
    if (projectedFreeBytes < floorBytes) {
      throw new Error(
        `Storage admission denied: ${freeBytes} bytes free, ${reservedBytes} bytes reserved, ` +
          `${expectedBytes} bytes requested, ${floorBytes} byte floor required.`,
      );
    }
    const id = randomUUID();
    const identityDigest = createHash("sha256")
      .update(`${taskId}\0${purpose}\0${id}`)
      .digest("hex")
      .slice(0, 24);
    const operationRegistryPath = path.join(path.dirname(registryPath), "operation-admission.json");
    const operationId = `storage-${identityDigest}`;
    const operation = runOperationAdmission([
      "acquire",
      "--registry",
      operationRegistryPath,
      "--operation-id",
      operationId,
      "--invocation-id",
      `storage-${randomUUID().replaceAll("-", "")}`,
      "--task-id",
      `storage-${identityDigest}`,
      "--owner",
      `storage-${createHash("sha256").update(owner).digest("hex").slice(0, 16)}`,
      "--claim",
      `storage-large:${createHash("sha256").update(resolvedVolumePath).digest("hex").slice(0, 16)}:exclusive`,
      "--priority",
      "high",
      "--pid",
      String(pid),
      "--ttl-ms",
      String(ttlMs),
      "--wait-ms",
      String(operationWaitMs),
      "--persist-on-timeout",
      "false",
    ]);
    const reservation = {
      id,
      state: "active",
      owner: owner.trim(),
      taskId: taskId.trim(),
      purpose: purpose.trim(),
      pid,
      expectedBytes,
      floorBytes,
      targetBytes,
      projectedFreeBytes,
      targetMetAtAdmission: projectedFreeBytes >= targetBytes,
      freeBytesAtAdmission: freeBytes,
      allowedRoots: normalizedRoots,
      volumePath: resolvedVolumePath,
      workspacePaths: [],
      createdAt: new Date(nowMs).toISOString(),
      heartbeatAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + ttlMs).toISOString(),
      operationAdmission: {
        registryPath: operationRegistryPath,
        operationId,
        ownerToken: operation.ownerToken,
      },
      ownerToken: randomUUID(),
    };
    try {
      registry.reservations[id] = reservation;
      trimTerminalReservations(registry);
      registry.updatedAt = new Date(nowMs).toISOString();
      atomicWriteJson(registryPath, registry);
      return { ...reservation, registryPath };
    } catch (error) {
      try {
        finishStorageOperation(reservation, "failed", "storage-registry-write-failed");
      } catch {
        // The shared operation remains fail-closed for explicit recovery.
      }
      throw error;
    }
  });
}

export function registerWorkspacePath({ reservation, workspacePath, nowMs = Date.now() }) {
  const candidate = resolveFuturePath(workspacePath);
  return withRegistryLock(reservation.registryPath, () => {
    const registry = readRegistry(reservation.registryPath);
    const current = registry.reservations[reservation.id];
    if (
      !isRecord(current) ||
      current.state !== "active" ||
      current.ownerToken !== reservation.ownerToken
    ) {
      throw new Error(`Temporary-workspace reservation is not active: ${reservation.id}`);
    }
    if (!current.allowedRoots.some((root) => containedPath(root, candidate))) {
      throw new Error(`Temporary workspace escapes its registered roots: ${candidate}`);
    }
    if (current.operationAdmission) {
      runOperationAdmission(
        [
          "workspace",
          "--registry",
          current.operationAdmission.registryPath,
          "--operation-id",
          current.operationAdmission.operationId,
          "--token",
          current.operationAdmission.ownerToken,
          "--path",
          candidate,
        ],
        { timeout: 30_000 },
      );
    }
    if (!current.workspacePaths.includes(candidate)) {
      current.workspacePaths.push(candidate);
      current.workspacePaths.sort((left, right) => left.localeCompare(right));
    }
    current.heartbeatAt = new Date(nowMs).toISOString();
    registry.updatedAt = current.heartbeatAt;
    atomicWriteJson(reservation.registryPath, registry);
    return structuredClone(current);
  });
}

/** Borrow an existing exact reservation instead of opening a competing nested admission. */
export function loadStorageReservation({
  registryPath = defaultRegistryPath(),
  reservationId,
  token,
}) {
  assertNonEmpty(reservationId, "reservationId");
  assertNonEmpty(token, "token");
  return withRegistryLock(registryPath, () => {
    const registry = readRegistry(registryPath);
    const current = registry.reservations[reservationId];
    if (
      !isRecord(current) ||
      current.state !== "active" ||
      current.ownerToken !== token ||
      !Array.isArray(current.allowedRoots)
    ) {
      throw new Error(`Temporary-workspace reservation is not active: ${reservationId}`);
    }
    const expiresAt = Date.parse(current.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      throw new Error(`Temporary-workspace reservation is expired: ${reservationId}`);
    }
    return { ...structuredClone(current), registryPath };
  });
}

export function releaseStorageReservation({
  reservation,
  state = "released",
  outcome = "completed",
  nowMs = Date.now(),
}) {
  if (!new Set(["released", "failed"]).has(state)) {
    throw new Error(`Invalid terminal reservation state: ${state}`);
  }
  assertNonEmpty(outcome, "outcome");
  return withRegistryLock(reservation.registryPath, () => {
    const registry = readRegistry(reservation.registryPath);
    const current = registry.reservations[reservation.id];
    if (
      !isRecord(current) ||
      current.state !== "active" ||
      current.ownerToken !== reservation.ownerToken
    ) {
      throw new Error(`Temporary-workspace reservation is not active: ${reservation.id}`);
    }
    finishStorageOperation(current, state === "released" ? "completed" : "failed", outcome);
    current.state = state;
    current.outcome = outcome;
    current.finishedAt = new Date(nowMs).toISOString();
    registry.updatedAt = current.finishedAt;
    trimTerminalReservations(registry);
    atomicWriteJson(reservation.registryPath, registry);
    return structuredClone(current);
  });
}

function visitTree(root, absolute, relative, hash, summary) {
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink()) {
    const linkTarget = fs.readlinkSync(absolute);
    let resolved;
    try {
      resolved = fs.realpathSync(absolute);
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
      resolved = path.resolve(path.dirname(absolute), linkTarget);
    }
    if (!containedPath(root, resolved) && resolved !== root) {
      throw new Error(`Disposable tree contains an escaping symlink: ${relative}`);
    }
    hash.update(`L\0${relative}\0${linkTarget}\0`);
    summary.entries += 1;
    return;
  }
  if (stat.isDirectory()) {
    hash.update(`D\0${relative}\0${stat.ino}\0${stat.mtimeMs}\0`);
    summary.entries += 1;
    for (const entry of fs.readdirSync(absolute).toSorted()) {
      visitTree(root, path.join(absolute, entry), path.posix.join(relative, entry), hash, summary);
    }
    return;
  }
  if (!stat.isFile()) {
    throw new Error(`Disposable tree contains a special filesystem entry: ${relative}`);
  }
  hash.update(`F\0${relative}\0${stat.size}\0${stat.mode & 0o777}\0${stat.mtimeMs}\0`);
  const descriptor = fs.openSync(absolute, "r");
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let bytesRead;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) {
        hash.update(buffer.subarray(0, bytesRead));
      }
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  hash.update("\0");
  summary.entries += 1;
  summary.logicalBytes += stat.size;
}

export function fingerprintDisposableTree(targetPath) {
  const target = fs.realpathSync(path.resolve(targetPath));
  const rootStat = fs.lstatSync(target);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`Disposable target must be a real directory: ${target}`);
  }
  const hash = createHash("sha256");
  const summary = { entries: 0, logicalBytes: 0 };
  visitTree(target, target, ".", hash, summary);
  return {
    path: target,
    inode: rootStat.ino,
    mtimeMs: rootStat.mtimeMs,
    entries: summary.entries,
    logicalBytes: summary.logicalBytes,
    treeSha256: hash.digest("hex"),
  };
}

function assertTargetAllowed(target, allowedRoots) {
  if (!allowedRoots.some((root) => containedPath(root, target))) {
    throw new Error(`Cleanup target escapes its allowed roots: ${target}`);
  }
}

export function createCleanupReceipt({
  paths,
  allowedRoots,
  reason,
  receiptPath,
  nowMs = Date.now(),
}) {
  assertNonEmpty(reason, "reason");
  if (!Array.isArray(paths) || paths.length !== 1) {
    throw new Error("Cleanup receipt requires exactly one path for failure-isolated application.");
  }
  const roots = normalizeAllowedRoots(allowedRoots);
  const targets = paths
    .map((candidate) => fs.realpathSync(path.resolve(candidate)))
    .toSorted((left, right) => left.localeCompare(right));
  if (new Set(targets).size !== targets.length) {
    throw new Error("Cleanup receipt contains duplicate paths.");
  }
  for (const target of targets) {
    assertTargetAllowed(target, roots);
  }
  const payload = {
    schema: RECEIPT_SCHEMA,
    decision: "approved-disposable",
    reason: reason.trim(),
    createdAt: new Date(nowMs).toISOString(),
    allowedRoots: roots,
    targets: targets.map(fingerprintDisposableTree),
  };
  const receipt = { ...payload, receiptSha256: sha256Canonical(payload) };
  atomicWriteJson(path.resolve(receiptPath), receipt);
  return receipt;
}

function noOpenHandles(target) {
  const result = spawnSync("lsof", ["+D", target], { encoding: "utf8", stdio: "pipe" });
  if (result.error) {
    throw new Error(`Unable to verify open handles for ${target}: ${result.error.message}`);
  }
  if (result.status === 0 && result.stdout.trim()) {
    return false;
  }
  if (![0, 1].includes(result.status)) {
    throw new Error(`Open-handle verification failed for ${target}: status ${result.status}`);
  }
  return true;
}

export function applyCleanupReceipt({ receiptPath, expectedReceiptSha256 }) {
  const receipt = readJson(path.resolve(receiptPath));
  const { receiptSha256, ...payload } = receipt;
  if (receipt.schema !== RECEIPT_SCHEMA || receipt.decision !== "approved-disposable") {
    throw new Error("Cleanup receipt schema or decision is invalid.");
  }
  if (!Array.isArray(receipt.targets) || receipt.targets.length !== 1) {
    throw new Error("Cleanup receipt must identify exactly one failure-isolated target.");
  }
  const actualReceiptSha256 = sha256Canonical(payload);
  if (receiptSha256 !== actualReceiptSha256 || expectedReceiptSha256 !== actualReceiptSha256) {
    throw new Error("Cleanup receipt digest does not match the approved digest.");
  }
  const roots = normalizeAllowedRoots(receipt.allowedRoots);
  for (const expected of receipt.targets) {
    assertTargetAllowed(expected.path, roots);
    const actual = fingerprintDisposableTree(expected.path);
    if (canonicalJson(actual) !== canonicalJson(expected)) {
      throw new Error(`Cleanup target changed after approval: ${expected.path}`);
    }
    if (!noOpenHandles(expected.path)) {
      throw new Error(`Cleanup target has an open handle: ${expected.path}`);
    }
  }
  for (const target of receipt.targets) {
    fs.rmSync(target.path, { recursive: true, force: false });
    if (fs.existsSync(target.path)) {
      throw new Error(`Cleanup target remains after removal: ${target.path}`);
    }
  }
  const result = {
    schema: "openclaw.disposable-cleanup-applied.v1",
    receiptSha256: actualReceiptSha256,
    removedPaths: receipt.targets.map((target) => target.path),
    logicalBytes: receipt.targets.reduce((total, target) => total + target.logicalBytes, 0),
    appliedAt: new Date().toISOString(),
  };
  const appliedReceiptPath = `${path.resolve(receiptPath)}.applied.json`;
  const appliedReceipt = { ...result, appliedReceiptSha256: sha256Canonical(result) };
  atomicWriteJson(appliedReceiptPath, appliedReceipt);
  return { ...appliedReceipt, appliedReceiptPath };
}

function parseCli(argv) {
  const [command, ...rest] = argv;
  const options = { command, allowedRoots: [] };
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid storage-admission argument: ${flag ?? "<end>"}`);
    }
    const key = flag.slice(2);
    if (key === "allowed-root") {
      options.allowedRoots.push(value);
    } else {
      options[key] = value;
    }
  }
  return options;
}

function cliReservation(input) {
  return {
    id: input["reservation-id"],
    ownerToken: input.token,
    registryPath: path.resolve(input.registry),
  };
}

function runCli() {
  const input = parseCli(process.argv.slice(2));
  if (input.command === "admit") {
    const reservation = acquireStorageReservation({
      owner: input.owner,
      taskId: input["task-id"],
      purpose: input.purpose,
      allowedRoots: input.allowedRoots,
      registryPath: path.resolve(input.registry),
      volumePath: input.volume,
      expectedBytes: Number(input["expected-bytes"] ?? DEFAULT_EXPECTED_WORKSPACE_BYTES),
      floorBytes: Number(input["floor-bytes"] ?? DEFAULT_STORAGE_FLOOR_BYTES),
      targetBytes: Number(input["target-bytes"] ?? DEFAULT_STORAGE_TARGET_BYTES),
      maxConcurrent: Number(input["max-concurrent"] ?? DEFAULT_MAX_CONCURRENT_WORKSPACES),
      ttlMs: Number(input["ttl-ms"] ?? DEFAULT_RESERVATION_TTL_MS),
      operationWaitMs: Number(input["wait-ms"] ?? 300_000),
      pid: Number(input.pid ?? process.ppid),
    });
    process.stdout.write(`${JSON.stringify(reservation)}\n`);
    return;
  }
  if (input.command === "register") {
    const result = registerWorkspacePath({
      reservation: cliReservation(input),
      workspacePath: input.path,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (input.command === "release") {
    const result = releaseStorageReservation({
      reservation: cliReservation(input),
      state: input.state ?? "released",
      outcome: input.outcome ?? "completed",
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  throw new Error(`Unknown storage-admission command: ${input.command ?? ""}`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 78;
  }
}

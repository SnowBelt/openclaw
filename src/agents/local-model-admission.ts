import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { formatErrorMessage } from "../infra/errors.js";

export const LOCAL_MODEL_ADMISSION_SCHEMA = "openclaw.local-model-admission.v1" as const;
export const LOCAL_MODEL_ADMISSION_ENV = "OPENCLAW_LOCAL_MODEL_ADMISSION_PATH" as const;
export const LOCAL_MODEL_ADMISSION_TOKEN_ENV = "OPENCLAW_LOCAL_MODEL_ADMISSION_TOKEN" as const;
export const LOCAL_MODEL_ADMISSION_MAX_WAIT_MS = 30 * 60 * 1000;
export const LOCAL_MODEL_ADMISSION_SAMPLE_INTERVAL_MS = 5_000;
export const LOCAL_MODEL_ADMISSION_DEFAULT_TTL_MS = 5 * 60 * 1000;
const COORDINATOR_LOCK_STALE_MS = 60_000;

export type LocalModelAdmissionMode = "shared" | "exclusive";

export type LocalModelResourceSnapshot = {
  observedAt: string;
  activeOpenClawWorkerCount: number;
  activeOllamaClientCount: number;
  activeOpenClawWorkerPids?: number[];
  activeOllamaClientPids?: number[];
};

type StoredLocalModelLease = {
  token: string;
  owner: string;
  mode: LocalModelAdmissionMode;
  pid: number;
  acquiredAt: number;
  expiresAt: number;
};

type StoredLocalModelState = {
  schema: typeof LOCAL_MODEL_ADMISSION_SCHEMA;
  leases: StoredLocalModelLease[];
};

export type LocalModelAdmissionErrorCode = "resource_contention" | "lease_state_invalid";

export class LocalModelAdmissionError extends Error {
  readonly code: LocalModelAdmissionErrorCode;

  constructor(code: LocalModelAdmissionErrorCode, message: string) {
    super(message);
    this.name = "LocalModelAdmissionError";
    this.code = code;
  }
}

export type LocalModelAdmissionLease = {
  readonly schema: typeof LOCAL_MODEL_ADMISSION_SCHEMA;
  readonly token: string;
  readonly owner: string;
  readonly mode: LocalModelAdmissionMode;
  readonly acquiredAt: number;
  expiresAt: number;
  readonly statePath: string;
  readonly borrowed: boolean;
  readonly samples: readonly LocalModelResourceSnapshot[];
  renew(): Promise<void>;
  release(): Promise<void>;
};

export type AcquireLocalModelAdmissionParams = {
  mode: LocalModelAdmissionMode;
  owner: string;
  statePath?: string;
  waitMs?: number;
  ttlMs?: number;
  probe?: () => LocalModelResourceSnapshot | Promise<LocalModelResourceSnapshot>;
  sampleIntervalMs?: number;
  signal?: AbortSignal;
};

const DEFAULT_LOCAL_MODEL_ADMISSION_PATH = path.join(
  path.parse(os.tmpdir()).root,
  "tmp",
  "openclaw-local-model-admission",
  "state.json",
);

function admissionError(
  code: LocalModelAdmissionErrorCode,
  message: string,
): LocalModelAdmissionError {
  return new LocalModelAdmissionError(code, message);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(
      admissionError("resource_contention", "blocked_resource_contention:admission aborted"),
    );
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
      }
      signal?.removeEventListener("abort", abort);
    };
    const complete = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve();
    };
    const abort = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(
        admissionError("resource_contention", "blocked_resource_contention:admission aborted"),
      );
    };
    const timer = setTimeout(complete, ms);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
    }
  });
}

function validateFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw admissionError("lease_state_invalid", `lease_state_invalid:${label} is invalid`);
  }
}

function resolveStatePath(value?: string): string {
  const selected =
    value?.trim() ||
    process.env[LOCAL_MODEL_ADMISSION_ENV]?.trim() ||
    DEFAULT_LOCAL_MODEL_ADMISSION_PATH;
  const resolved = path.resolve(selected);
  if (resolved === path.parse(resolved).root || path.basename(resolved) === "") {
    throw admissionError(
      "lease_state_invalid",
      "lease_state_invalid:lease path is not a regular file path",
    );
  }
  return resolved;
}

function ensurePrivateParent(statePath: string): void {
  const parent = path.dirname(statePath);
  try {
    fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
    const info = fs.lstatSync(parent);
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) {
      throw admissionError("lease_state_invalid", "lease_state_invalid:lease directory is unsafe");
    }
    fs.chmodSync(parent, 0o700);
  } catch (error) {
    if (error instanceof LocalModelAdmissionError) {
      throw error;
    }
    throw admissionError(
      "lease_state_invalid",
      "lease_state_invalid:lease directory is unavailable",
    );
  }
}

function readState(statePath: string): StoredLocalModelState {
  try {
    const info = fs.lstatSync(statePath);
    if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) {
      throw admissionError(
        "lease_state_invalid",
        "lease_state_invalid:lease state is not a private file",
      );
    }
    const value = JSON.parse(fs.readFileSync(statePath, "utf8")) as Record<string, unknown>;
    if (value.schema !== LOCAL_MODEL_ADMISSION_SCHEMA || !Array.isArray(value.leases)) {
      throw admissionError(
        "lease_state_invalid",
        "lease_state_invalid:lease state schema is invalid",
      );
    }
    const leases: StoredLocalModelLease[] = [];
    for (const item of value.leases) {
      if (!isStoredLease(item)) {
        throw admissionError("lease_state_invalid", "lease_state_invalid:lease entry is invalid");
      }
      leases.push({ ...item });
    }
    return { schema: LOCAL_MODEL_ADMISSION_SCHEMA, leases };
  } catch (error) {
    if (isMissingPathError(error)) {
      return { schema: LOCAL_MODEL_ADMISSION_SCHEMA, leases: [] };
    }
    if (error instanceof LocalModelAdmissionError) {
      throw error;
    }
    throw admissionError("lease_state_invalid", "lease_state_invalid:lease state is unreadable");
  }
}

function isStoredLease(value: unknown): value is StoredLocalModelLease {
  if (!value || typeof value !== "object") {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (
    typeof row.token === "string" &&
    row.token.length > 0 &&
    typeof row.owner === "string" &&
    row.owner.trim().length > 0 &&
    (row.mode === "shared" || row.mode === "exclusive") &&
    typeof row.pid === "number" &&
    Number.isInteger(row.pid) &&
    row.pid > 0 &&
    typeof row.acquiredAt === "number" &&
    Number.isInteger(row.acquiredAt) &&
    typeof row.expiresAt === "number" &&
    Number.isInteger(row.expiresAt) &&
    row.expiresAt > row.acquiredAt
  );
}

function isMissingPathError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT",
  );
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function pruneState(state: StoredLocalModelState, now: number): StoredLocalModelState {
  return {
    schema: LOCAL_MODEL_ADMISSION_SCHEMA,
    leases: state.leases.filter((lease) => lease.expiresAt > now && processIsAlive(lease.pid)),
  };
}

function writeState(statePath: string, state: StoredLocalModelState): void {
  ensurePrivateParent(statePath);
  const temporary = `${statePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(
      temporary,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
      0o600,
    );
    const payload = `${JSON.stringify(state)}\n`;
    fs.writeFileSync(descriptor, payload, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, statePath);
    fs.chmodSync(statePath, 0o600);
    const directory = fs.openSync(path.dirname(statePath), fs.constants.O_RDONLY);
    try {
      fs.fsyncSync(directory);
    } finally {
      fs.closeSync(directory);
    }
  } catch (error) {
    if (descriptor !== undefined) {
      fs.closeSync(descriptor);
    }
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      // Preserve the original write error.
    }
    throw error;
  }
}

async function withCoordinatorLock<T>(statePath: string, operation: () => Promise<T>): Promise<T> {
  ensurePrivateParent(statePath);
  const lockPath = `${statePath}.lock`;
  const deadline = Date.now() + 1_000;
  let descriptor: number | undefined;
  while (descriptor === undefined) {
    try {
      descriptor = fs.openSync(
        lockPath,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
        0o600,
      );
      fs.writeFileSync(descriptor, `${process.pid}\n`, "utf8");
      fs.fsyncSync(descriptor);
    } catch (error) {
      if (descriptor !== undefined) {
        try {
          fs.closeSync(descriptor);
        } catch {
          // Preserve the lock acquisition error.
        }
        try {
          fs.rmSync(lockPath, { force: true });
        } catch {
          // A failed lock cleanup is handled as an unavailable coordinator.
        }
        throw admissionError(
          "lease_state_invalid",
          "lease_state_invalid:coordinator lock is unavailable",
        );
      }
      if (
        !(
          error &&
          typeof error === "object" &&
          "code" in error &&
          (error as { code?: unknown }).code === "EEXIST"
        )
      ) {
        throw admissionError(
          "lease_state_invalid",
          "lease_state_invalid:coordinator lock is unavailable",
        );
      }
      try {
        const info = fs.lstatSync(lockPath);
        if (!info.isFile() || info.isSymbolicLink()) {
          throw admissionError(
            "lease_state_invalid",
            "lease_state_invalid:coordinator lock is unsafe",
          );
        }
        if (Date.now() - info.mtimeMs > COORDINATOR_LOCK_STALE_MS) {
          fs.rmSync(lockPath);
          continue;
        }
      } catch (lockError) {
        if (lockError instanceof LocalModelAdmissionError) {
          throw lockError;
        }
        if (isMissingPathError(lockError)) {
          continue;
        }
        throw admissionError(
          "lease_state_invalid",
          "lease_state_invalid:coordinator lock is unreadable",
        );
      }
      if (Date.now() >= deadline) {
        throw admissionError(
          "resource_contention",
          "blocked_resource_contention:coordinator lock is held",
        );
      }
      await sleep(25);
    }
  }
  try {
    return await operation();
  } finally {
    if (descriptor !== undefined) {
      fs.closeSync(descriptor);
    }
    try {
      fs.rmSync(lockPath, { force: true });
    } catch {
      // Do not hide an operation result behind cleanup of the coordinator lock.
    }
  }
}

function validateSnapshot(snapshot: LocalModelResourceSnapshot): void {
  if (
    typeof snapshot.observedAt !== "string" ||
    !Number.isInteger(snapshot.activeOpenClawWorkerCount) ||
    snapshot.activeOpenClawWorkerCount < 0 ||
    !Number.isInteger(snapshot.activeOllamaClientCount) ||
    snapshot.activeOllamaClientCount < 0
  ) {
    throw admissionError(
      "lease_state_invalid",
      "lease_state_invalid:resource probe returned invalid data",
    );
  }
}

async function renewLease(statePath: string, token: string, ttlMs: number): Promise<number> {
  const expiresAt = Date.now() + ttlMs;
  await withCoordinatorLock(statePath, async () => {
    const state = pruneState(readState(statePath), Date.now());
    const lease = state.leases.find((row) => row.token === token);
    if (!lease) {
      throw admissionError("lease_state_invalid", "lease_state_invalid:owned lease disappeared");
    }
    lease.expiresAt = expiresAt;
    writeState(statePath, state);
  });
  return expiresAt;
}

async function releaseLease(statePath: string, token: string): Promise<void> {
  await withCoordinatorLock(statePath, async () => {
    const state = pruneState(readState(statePath), Date.now());
    const before = state.leases.length;
    state.leases = state.leases.filter((row) => row.token !== token);
    if (state.leases.length === before) {
      throw admissionError(
        "lease_state_invalid",
        "lease_state_invalid:owned lease disappeared before release",
      );
    }
    writeState(statePath, state);
  });
}

function makeLease(params: {
  stored: StoredLocalModelLease;
  statePath: string;
  borrowed: boolean;
  samples: readonly LocalModelResourceSnapshot[];
  ttlMs: number;
}): LocalModelAdmissionLease {
  let expiresAt = params.stored.expiresAt;
  let released = false;
  let renewalError: unknown;
  let timer: NodeJS.Timeout | undefined;
  const renew = async () => {
    if (released || params.borrowed) {
      return;
    }
    expiresAt = await renewLease(params.statePath, params.stored.token, params.ttlMs);
  };
  if (!params.borrowed) {
    timer = setInterval(
      () => {
        void renew().catch((error: unknown) => {
          renewalError = error;
        });
      },
      Math.max(1, Math.floor(params.ttlMs / 3)),
    );
    timer.unref?.();
  }
  return {
    schema: LOCAL_MODEL_ADMISSION_SCHEMA,
    token: params.stored.token,
    owner: params.stored.owner,
    mode: params.stored.mode,
    acquiredAt: params.stored.acquiredAt,
    get expiresAt() {
      return expiresAt;
    },
    set expiresAt(value: number) {
      expiresAt = value;
    },
    statePath: params.statePath,
    borrowed: params.borrowed,
    samples: params.samples,
    renew: async () => {
      if (renewalError) {
        throw renewalError instanceof Error
          ? renewalError
          : new Error(formatErrorMessage(renewalError));
      }
      await renew();
    },
    release: async () => {
      if (released || params.borrowed) {
        return;
      }
      released = true;
      if (timer) {
        clearInterval(timer);
      }
      if (renewalError) {
        try {
          await releaseLease(params.statePath, params.stored.token);
        } catch {
          // Preserve the renewal error as the primary failure.
        }
        throw renewalError instanceof Error
          ? renewalError
          : new Error(formatErrorMessage(renewalError));
      }
      await releaseLease(params.statePath, params.stored.token);
    },
  };
}

export async function acquireLocalModelAdmission(
  params: AcquireLocalModelAdmissionParams,
): Promise<LocalModelAdmissionLease> {
  if ((params.mode !== "shared" && params.mode !== "exclusive") || !params.owner.trim()) {
    throw admissionError("lease_state_invalid", "lease_state_invalid:mode and owner are required");
  }
  const waitMs = params.waitMs ?? LOCAL_MODEL_ADMISSION_MAX_WAIT_MS;
  const ttlMs = params.ttlMs ?? LOCAL_MODEL_ADMISSION_DEFAULT_TTL_MS;
  const sampleIntervalMs = params.sampleIntervalMs ?? LOCAL_MODEL_ADMISSION_SAMPLE_INTERVAL_MS;
  validateFiniteNonNegative(waitMs, "waitMs");
  validateFiniteNonNegative(sampleIntervalMs, "sampleIntervalMs");
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || waitMs > LOCAL_MODEL_ADMISSION_MAX_WAIT_MS) {
    throw admissionError("lease_state_invalid", "lease_state_invalid:lease timing is invalid");
  }
  if (params.mode === "exclusive" && !params.probe) {
    throw admissionError(
      "lease_state_invalid",
      "lease_state_invalid:exclusive admission requires a resource probe",
    );
  }
  const statePath = resolveStatePath(params.statePath);
  const inheritedToken = process.env[LOCAL_MODEL_ADMISSION_TOKEN_ENV]?.trim();
  if (inheritedToken) {
    const stored = await withCoordinatorLock(statePath, async () => {
      const state = pruneState(readState(statePath), Date.now());
      const found = state.leases.find((row) => row.token === inheritedToken);
      if (!found || found.mode !== "exclusive") {
        throw admissionError(
          "lease_state_invalid",
          "lease_state_invalid:inherited exclusive lease token is invalid",
        );
      }
      return found;
    });
    return makeLease({ stored, statePath, borrowed: true, samples: [], ttlMs });
  }

  const deadline = Date.now() + waitMs;
  const token = crypto.randomUUID().replaceAll("-", "");
  let stored: StoredLocalModelLease;
  while (true) {
    if (params.signal?.aborted) {
      throw admissionError("resource_contention", "blocked_resource_contention:admission aborted");
    }
    const now = Date.now();
    const acquired = await withCoordinatorLock(statePath, async () => {
      const state = pruneState(readState(statePath), now);
      const conflict =
        params.mode === "exclusive"
          ? state.leases.length > 0
          : state.leases.some((lease) => lease.mode === "exclusive");
      if (!conflict) {
        const next: StoredLocalModelLease = {
          token,
          owner: params.owner.trim(),
          mode: params.mode,
          pid: process.pid,
          acquiredAt: now,
          expiresAt: now + ttlMs,
        };
        state.leases.push(next);
        writeState(statePath, state);
        return next;
      }
      return undefined;
    });
    if (acquired) {
      stored = acquired;
      break;
    }
    if (Date.now() >= deadline) {
      throw admissionError(
        "resource_contention",
        "blocked_resource_contention:local-model admission is busy",
      );
    }
    await sleep(Math.min(250, Math.max(10, deadline - Date.now())), params.signal);
  }

  const samples: LocalModelResourceSnapshot[] = [];
  const lease = makeLease({ stored, statePath, borrowed: false, samples, ttlMs });
  try {
    if (params.mode === "exclusive") {
      while (samples.length < 3) {
        const snapshot = await params.probe!();
        validateSnapshot(snapshot);
        if (snapshot.activeOpenClawWorkerCount === 0 && snapshot.activeOllamaClientCount === 0) {
          samples.push({ ...snapshot });
        } else {
          samples.length = 0;
        }
        if (samples.length < 3) {
          if (Date.now() >= deadline) {
            throw admissionError(
              "resource_contention",
              "blocked_resource_contention:three zero-worker and zero-client samples were not proven",
            );
          }
          await sleep(
            Math.min(sampleIntervalMs, Math.max(0, deadline - Date.now())),
            params.signal,
          );
        }
      }
    }
    // Sampling can legitimately wait much longer than the base lease TTL.
    // Start renewal as soon as the exclusive lease is stored, then prove once
    // more that the lease still exists before exposing it to the caller.
    await lease.renew();
    return lease;
  } catch (error) {
    try {
      await lease.release();
    } catch {
      // The original admission failure is more actionable; the missing lease is fail-closed on the next attempt.
    }
    throw error;
  }
}

export async function acquireExclusiveLocalModelAdmission(
  params: Omit<AcquireLocalModelAdmissionParams, "mode">,
): Promise<LocalModelAdmissionLease> {
  return acquireLocalModelAdmission({ ...params, mode: "exclusive" });
}

export async function acquireSharedLocalModelAdmission(
  params: Omit<AcquireLocalModelAdmissionParams, "mode" | "probe">,
): Promise<LocalModelAdmissionLease> {
  return acquireLocalModelAdmission({ ...params, mode: "shared" });
}

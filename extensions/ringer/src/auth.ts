// SAFETY-RATCHET: template-aware
// SAFETY-RATCHET: template-aware
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveRequiredConfiguredSecretRefInputString } from "openclaw/plugin-sdk/secret-input-runtime";
import type { OpenClawConfig } from "../api.js";
import { verifyCallerAuth } from "./crypto.js";
import type { ResolvedRingerConfig, RingerCallerAuth } from "./types.js";

type NonceState = Record<string, string>;

const NONCE_LOCK_WAIT_MS = 10_000;
const NONCE_LOCK_STALE_MS = 30_000;

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const handle = await fs.open(temp, "w", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temp, file);
  await fs.chmod(file, 0o600);
}

async function ensurePrivateDirectory(directory: string, label: string): Promise<void> {
  try {
    const stat = await fs.lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`${label} must be a real directory.`);
    }
    if ((stat.mode & 0o077) !== 0) {
      throw new Error(`${label} must have 0700 permissions.`);
    }
  } catch (error) {
    // SAFETY: Node filesystem errors expose the documented errno code property.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`${label} must be a real directory.`, { cause: error });
    }
  }
  await fs.chmod(directory, 0o700);
}

async function assertPrivateNonceFile(file: string): Promise<void> {
  const stat = await fs.lstat(file);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error("Caller nonce store must be a private regular file.");
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new Error("Caller nonce store must have 0600 permissions.");
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // SAFETY: process.kill failures are Node errno errors with a code property.
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function removeStaleNonceLock(lockDir: string): Promise<boolean> {
  let stat: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    stat = await fs.lstat(lockDir);
  } catch (error) {
    // SAFETY: Node filesystem errors expose the documented errno code property.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("Caller nonce lock must be a real directory.");
  }
  const ownerPath = path.join(lockDir, "owner.json");
  let owner: { pid: number; acquiredAt: string; token: string } | undefined;
  try {
    const ownerStat = await fs.lstat(ownerPath);
    if (ownerStat.isSymbolicLink() || !ownerStat.isFile() || (ownerStat.mode & 0o077) !== 0) {
      throw new Error("Caller nonce lock owner must be a private regular file.");
    }
    const raw: unknown = JSON.parse(await fs.readFile(ownerPath, "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("Caller nonce lock owner is corrupt.");
    }
    // SAFETY: The object/array guard above establishes a record-like JSON value.
    const candidate = raw as Record<string, unknown>;
    if (
      typeof candidate.pid !== "number" ||
      !Number.isInteger(candidate.pid) ||
      candidate.pid <= 0 ||
      typeof candidate.acquiredAt !== "string" ||
      typeof candidate.token !== "string" ||
      !candidate.token
    ) {
      throw new Error("Caller nonce lock owner is corrupt.");
    }
    owner = {
      pid: candidate.pid,
      acquiredAt: candidate.acquiredAt,
      token: candidate.token,
    };
  } catch (error) {
    // SAFETY: Node filesystem errors expose the documented errno code property.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // A process can die between mkdir and writing owner.json. Keep the
      // lock fail-closed until the directory itself is old enough to reap.
      if (Date.now() - stat.mtimeMs < NONCE_LOCK_STALE_MS) {
        return false;
      }
    } else {
      throw error;
    }
  }
  if (owner) {
    const acquiredAt = Date.parse(owner.acquiredAt);
    if (
      !Number.isFinite(acquiredAt) ||
      Date.now() - acquiredAt < NONCE_LOCK_STALE_MS ||
      processIsAlive(owner.pid)
    ) {
      return false;
    }
  }
  const quarantine = `${lockDir}.stale-${crypto.randomUUID()}`;
  try {
    await fs.rename(lockDir, quarantine);
  } catch (error) {
    // SAFETY: Node filesystem errors expose the documented errno code property.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    // SAFETY: Node filesystem errors expose the documented errno code property.
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return false;
    }
    throw error;
  }
  await fs.rm(quarantine, { recursive: true, force: true });
  return true;
}

async function acquireNonceLock(nonceDir: string): Promise<() => Promise<void>> {
  const lockDir = path.join(nonceDir, "nonces.lock");
  const startedAt = Date.now();
  while (Date.now() - startedAt < NONCE_LOCK_WAIT_MS) {
    try {
      await fs.mkdir(lockDir, { mode: 0o700 });
      await fs.chmod(lockDir, 0o700);
      const owner = {
        pid: process.pid,
        acquiredAt: new Date().toISOString(),
        token: crypto.randomUUID(),
      };
      await fs.writeFile(path.join(lockDir, "owner.json"), `${JSON.stringify(owner)}\n`, {
        mode: 0o600,
        flag: "wx",
      });
      return async () => {
        try {
          const ownerPath = path.join(lockDir, "owner.json");
          const ownerStat = await fs.lstat(ownerPath);
          if (ownerStat.isSymbolicLink() || !ownerStat.isFile()) {
            return;
          }
          // SAFETY: The owner file is written by this module with this shape.
          const current = JSON.parse(await fs.readFile(ownerPath, "utf8")) as {
            token?: unknown;
          };
          if (current.token !== owner.token) {
            return;
          }
          await fs.rm(lockDir, { recursive: true, force: true });
        } catch (error) {
          // SAFETY: Node filesystem errors expose the documented errno code property.
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw error;
          }
        }
      };
    } catch (error) {
      // SAFETY: Node filesystem errors expose the documented errno code property.
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      await removeStaleNonceLock(lockDir);
      await new Promise((resolve) => {
        setTimeout(resolve, 25);
      });
    }
  }
  throw new Error("Caller nonce store is busy; replay protection is unavailable.");
}

export class CallerProofVerifier {
  readonly #config: ResolvedRingerConfig;
  readonly #appConfig: OpenClawConfig;
  #queue: Promise<void> = Promise.resolve();

  constructor(config: ResolvedRingerConfig, appConfig: OpenClawConfig) {
    this.#config = config;
    this.#appConfig = appConfig;
  }

  async resolveSecret(): Promise<string> {
    const secret = await resolveRequiredConfiguredSecretRefInputString({
      config: this.#appConfig,
      env: process.env,
      value: this.#config.callerSecret,
      path: "plugins.entries.ringer.config.callerSecret",
    });
    if (!secret || Buffer.byteLength(secret) < 32) {
      throw new Error("Local AI Assist caller secret must contain at least 32 bytes.");
    }
    return secret;
  }

  async verifyAndConsume(payload: Record<string, unknown>, auth: RingerCallerAuth): Promise<void> {
    const operation = this.#queue.then(async () => {
      const secret = await this.resolveSecret();
      verifyCallerAuth({ payload, auth, secret });
      const nonceDir = path.join(this.#config.stateDir, "auth");
      const nonceFile = path.join(nonceDir, "nonces.json");
      await ensurePrivateDirectory(nonceDir, "Caller nonce directory");
      const releaseLock = await acquireNonceLock(nonceDir);
      try {
        let state: NonceState = {};
        let nonceFileExists = true;
        try {
          await fs.lstat(nonceFile);
        } catch (error) {
          // SAFETY: Node filesystem errors expose the documented errno code property.
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw error;
          }
          nonceFileExists = false;
        }
        if (nonceFileExists) {
          await assertPrivateNonceFile(nonceFile);
        }
        try {
          if (nonceFileExists) {
            // SAFETY: The nonce file is written by this module and validated below.
            state = JSON.parse(await fs.readFile(nonceFile, "utf8")) as NonceState;
          }
        } catch (error) {
          throw new Error("Caller nonce store is corrupt or unreadable.", { cause: error });
        }
        const now = Date.now();
        for (const [nonce, expiresAt] of Object.entries(state)) {
          if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) < now) {
            delete state[nonce];
          }
        }
        if (state[auth.nonce]) {
          throw new Error("Caller nonce has already been used.");
        }
        state[auth.nonce] = auth.expiresAt;
        await writeJsonAtomic(nonceFile, state);
      } finally {
        await releaseLock();
      }
    });
    this.#queue = operation.catch(() => {});
    await operation;
  }
}

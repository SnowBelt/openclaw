import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createAsyncLock } from "../infra/json-files.js";

const storeMutationLocks = new Map<string, ReturnType<typeof createAsyncLock>>();

/**
 * Serializes a complete read-modify-write operation for one SIG store file.
 *
 * Atomic replacement protects readers from torn writes, but it cannot prevent
 * two concurrent writers from each reading the same old snapshot. Gateway
 * mutation paths use this helper around their entire transaction so an update
 * cannot discard a previously committed sibling update.
 */
export async function withSelfImprovementStoreMutation<T>(
  storePath: string,
  mutate: () => Promise<T>,
): Promise<T> {
  const key = path.resolve(storePath);
  let lock = storeMutationLocks.get(key);
  if (!lock) {
    lock = createAsyncLock();
    storeMutationLocks.set(key, lock);
  }
  return await lock(mutate);
}

function isUnsupportedDirectorySyncError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EISDIR" || code === "EINVAL" || code === "ENOTSUP" || code === "EPERM";
}

async function syncParentDirectory(filePath: string): Promise<void> {
  try {
    const handle = await fs.open(path.dirname(filePath), "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (!isUnsupportedDirectorySyncError(error)) {
      throw error;
    }
  }
}

export async function writeSelfImprovementJsonAtomically(
  filePath: string,
  value: unknown,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`;
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(tmpPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(tmpPath, filePath);
    await fs.chmod(filePath, 0o600);
    await syncParentDirectory(filePath);
  } finally {
    if (handle) {
      await handle.close().catch(() => undefined);
    }
    await fs.rm(tmpPath, { force: true }).catch(() => undefined);
  }
}

// SAFETY-RATCHET: template-aware
import fs from "node:fs/promises";
import path from "node:path";
import type { WorkspaceState } from "./snapshot.js";
import type { ResolvedRingerConfig } from "./types.js";

const SNAPSHOT_STORAGE_SAFETY_MULTIPLIER = 1.25;
const SNAPSHOT_STORAGE_OVERHEAD_BYTES = 64 * 1024 * 1024;
const MINIMUM_FREE_BYTES_AFTER_SNAPSHOT = 1 * 1024 * 1024 * 1024;

async function measureSnapshotStorage(root: string, containmentRoot = root): Promise<number> {
  let total = 0;
  let rootStat: import("node:fs").Stats;
  try {
    rootStat = await fs.lstat(root);
  } catch (error) {
    // SAFETY: Node filesystem errors expose the documented errno code property.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return 0;
    }
    throw error;
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`Snapshot storage root must be a real directory: ${root}`);
  }
  const canonicalContainmentRoot = await fs.realpath(containmentRoot);
  const containmentPrefix = canonicalContainmentRoot.endsWith(path.sep)
    ? canonicalContainmentRoot
    : `${canonicalContainmentRoot}${path.sep}`;
  const entries: import("node:fs").Dirent[] = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isSymbolicLink()) {
      let resolved: string;
      try {
        resolved = await fs.realpath(target);
      } catch (error) {
        throw new Error(`Snapshot storage contains a broken symbolic link: ${target}`, {
          cause: error,
        });
      }
      if (resolved !== canonicalContainmentRoot && !resolved.startsWith(containmentPrefix)) {
        throw new Error(`Snapshot storage contains an external symbolic link: ${target}`);
      }
      continue;
    }
    if (entry.isDirectory()) {
      total += await measureSnapshotStorage(target, canonicalContainmentRoot);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Snapshot storage contains an unsupported filesystem entry: ${target}`);
    }
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`Snapshot storage entry changed while being inspected: ${target}`);
    }
    total += stat.size;
    if (!Number.isSafeInteger(total)) {
      throw new Error("Unable to measure retained snapshot storage safely.");
    }
  }
  return total;
}

export async function assertSnapshotStorage(params: {
  config: ResolvedRingerConfig;
  state: WorkspaceState;
  replaceSnapshotRoot: string;
}): Promise<void> {
  const estimatedBytes =
    params.state.trackedBytes +
    params.state.diff.byteLength +
    [...params.state.untrackedContents.values()].reduce(
      (total, value) => total + value.byteLength,
      0,
    );
  const reservedBytes =
    Math.ceil(estimatedBytes * SNAPSHOT_STORAGE_SAFETY_MULTIPLIER) +
    SNAPSHOT_STORAGE_OVERHEAD_BYTES;
  const maxParallel = Math.max(1, Math.floor(params.config.maxParallel || 1));
  const transientWorktreeBytes = reservedBytes * maxParallel;
  if (!Number.isSafeInteger(transientWorktreeBytes)) {
    throw new Error("Unable to estimate transient task worktree storage safely.");
  }
  const maxStorageBytes = params.config.maxSnapshotStorageBytes ?? 16 * 1024 * 1024 * 1024;
  if (reservedBytes > maxStorageBytes) {
    throw new Error(
      `Snapshot storage estimate ${reservedBytes} bytes exceeds the ${maxStorageBytes}-byte policy limit.`,
    );
  }
  await fs.mkdir(params.config.stateDir, { recursive: true, mode: 0o700 });
  const retainedRoots = [
    path.join(params.config.stateDir, "snapshots"),
    path.join(params.config.stateDir, "preparations"),
    path.join(params.config.stateDir, "runs"),
    path.join(params.config.stateDir, "upstream"),
  ];
  const retainedBytes =
    (
      await Promise.all(
        retainedRoots.map((root) => measureSnapshotStorage(root, params.config.stateDir)),
      )
    ).reduce((total, value) => total + value, 0) -
    (await measureSnapshotStorage(params.replaceSnapshotRoot));
  if (!Number.isSafeInteger(retainedBytes) || retainedBytes < 0) {
    throw new Error("Unable to measure retained snapshot and task state storage safely.");
  }
  if (retainedBytes + reservedBytes > maxStorageBytes) {
    throw new Error(
      `Retained snapshot storage (including task state) ${retainedBytes} bytes plus the ${reservedBytes}-byte estimate exceeds the ${maxStorageBytes}-byte policy limit.`,
    );
  }
  let availableBytes: number;
  try {
    const stats = await fs.statfs(params.config.stateDir);
    availableBytes = stats.bavail * stats.bsize;
  } catch (error) {
    throw new Error(
      `Unable to verify free storage before snapshot creation: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const requiredBytes = reservedBytes + transientWorktreeBytes + MINIMUM_FREE_BYTES_AFTER_SNAPSHOT;
  if (!Number.isSafeInteger(availableBytes) || availableBytes < requiredBytes) {
    throw new Error(
      `Insufficient free storage for immutable snapshot and up to ${maxParallel} task worktree(s): need ${requiredBytes} bytes, have ${availableBytes}.`,
    );
  }
}

export async function writeJsonPrivate(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.chmod(filePath, 0o600);
}

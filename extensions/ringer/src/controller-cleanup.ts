// SAFETY-RATCHET: template-aware
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  dockerEnv,
  isOwnedRingerProcess,
  isProcessAlive,
  listLocalWorkerContainers,
} from "./controller-capacity.js";
import {
  findCorruptRunReceipts,
  isPathWithin,
  preparationRoot,
  readRunReceipts,
} from "./controller-receipts.js";
import { runCommand, SAFE_EXEC_PATH } from "./process.js";
import { loadSnapshot } from "./snapshot.js";
import type { ResolvedRingerConfig, RingerRunReceipt } from "./types.js";

const CONTAINER_CLEANUP_ATTEMPTS = 20;
const CONTAINER_CLEANUP_INTERVAL_MS = 250;
const CONTAINER_CLEANUP_DEADLINE_MS = 15_000;

export async function inspectCleanupState(
  config: ResolvedRingerConfig,
  existingRuns?: RingerRunReceipt[],
): Promise<Record<string, unknown>> {
  const runs = existingRuns ?? (await readRunReceipts(config));
  const activeManifestDigests = new Set(
    runs
      .filter((run) => run.status === "queued" || run.status === "running")
      .map((run) => run.manifestSha256),
  );
  const orphanedRunIds = runs
    .filter(
      (run) =>
        (run.status === "queued" || run.status === "running") &&
        (!run.pid || !isProcessAlive(run.pid)),
    )
    .map((run) => run.runId);
  const terminalProcessLeaks = runs
    .filter(
      (run) =>
        !["queued", "running"].includes(run.status) && Boolean(run.pid && isProcessAlive(run.pid)),
    )
    .map((run) => run.runId);
  const unverifiedActiveProcessIds: string[] = [];
  for (const run of runs.filter(
    (candidate) =>
      (candidate.status === "queued" || candidate.status === "running") &&
      Boolean(candidate.pid && isProcessAlive(candidate.pid)),
  )) {
    if (!(await isOwnedRingerProcess(config, run))) {
      unverifiedActiveProcessIds.push(run.runId);
    }
  }
  const staleWorktrees: string[] = [];
  const preparationsRoot = path.join(config.stateDir, "preparations");
  let preparations: Dirent[] = [];
  try {
    preparations = await fs.readdir(preparationsRoot, { withFileTypes: true });
  } catch {}
  for (const preparation of preparations) {
    if (!preparation.isDirectory() || activeManifestDigests.has(preparation.name)) {
      continue;
    }
    const worktreesRoot = path.join(preparationsRoot, preparation.name, "worktrees");
    let entries: Dirent[] = [];
    try {
      entries = await fs.readdir(worktreesRoot, { withFileTypes: true });
    } catch {}
    for (const entry of entries) {
      if ((entry.isDirectory() || entry.isSymbolicLink()) && entry.name !== "logs") {
        const candidate = path.join(worktreesRoot, entry.name);
        try {
          const stat = await fs.lstat(candidate);
          if (stat.isSymbolicLink() || stat.isDirectory()) {
            // A terminal preparation must not retain a task worktree. The
            // directory is a leak even when it was created moments ago;
            // waiting for raw-retention age would hide cancellation races.
            staleWorktrees.push(candidate);
          }
        } catch {
          // A disappearing entry is reconciled by the next audit pass.
        }
      }
    }
  }
  const activePreparationRoots = new Set(
    [...activeManifestDigests].map((manifestSha256) =>
      path.join(preparationsRoot, manifestSha256, "worktrees"),
    ),
  );
  const taskContainerLeaks: string[] = [];
  for (const container of await listLocalWorkerContainers(config)) {
    const protectedByActiveRun = container.mountSources.some((source) =>
      [...activePreparationRoots].some((root) => isPathWithin(root, source)),
    );
    if (
      !protectedByActiveRun &&
      container.mountSources.some((source) => isPathWithin(preparationsRoot, source))
    ) {
      taskContainerLeaks.push(`${container.name} (${container.status})`);
    }
  }
  return {
    orphanedRunIds,
    terminalProcessLeaks,
    unverifiedActiveProcessIds,
    staleWorktrees,
    taskContainerLeaks,
    reconciled:
      orphanedRunIds.length === 0 &&
      terminalProcessLeaks.length === 0 &&
      unverifiedActiveProcessIds.length === 0 &&
      taskContainerLeaks.length === 0 &&
      staleWorktrees.length === 0,
  };
}

export async function cleanupRunWorktrees(
  config: ResolvedRingerConfig,
  receipt: RingerRunReceipt,
): Promise<void> {
  const preparationDir = preparationRoot(config, receipt.manifestSha256);
  const worktreeRoot = path.join(preparationDir, "worktrees");
  try {
    let shadowRepo: string | undefined;
    try {
      shadowRepo = (await loadSnapshot(config, receipt.snapshotId)).shadowRepo;
    } catch {
      // An expired snapshot can still have a valid Git worktree registry. Use
      // only the exact retained state path for cleanup, then fall back to
      // removing task worktree directories whose Git metadata points inside
      // this adapter's state directory.
      const snapshotsRoot = path.join(config.stateDir, "snapshots");
      const candidate = path.join(snapshotsRoot, receipt.snapshotId, "repo");
      try {
        const [rootStat, snapshotStat, repoStat] = await Promise.all([
          fs.lstat(snapshotsRoot),
          fs.lstat(path.dirname(candidate)),
          fs.lstat(candidate),
        ]);
        if (
          !rootStat.isSymbolicLink() &&
          rootStat.isDirectory() &&
          !snapshotStat.isSymbolicLink() &&
          snapshotStat.isDirectory() &&
          !repoStat.isSymbolicLink() &&
          repoStat.isDirectory()
        ) {
          shadowRepo = candidate;
        }
      } catch {
        // The snapshot was already removed; directory-level cleanup below is
        // still safe when the worktree metadata points into stateDir.
      }
    }
    if (!shadowRepo) {
      await removeOrphanedWorktreeDirectories(config, worktreeRoot);
      return;
    }
    const result = await runCommand("git", ["-C", shadowRepo, "worktree", "list", "--porcelain"], {
      timeoutMs: 30_000,
      env: { PATH: SAFE_EXEC_PATH, GIT_CONFIG_NOSYSTEM: "1" },
    });
    if (result.code === 0) {
      for (const line of result.stdout.toString("utf8").split(/\r?\n/u)) {
        if (!line.startsWith("worktree ")) {
          continue;
        }
        const target = path.resolve(line.slice("worktree ".length));
        const relative = path.relative(worktreeRoot, target);
        if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
          continue;
        }
        await runCommand("git", ["-C", shadowRepo, "worktree", "remove", "--force", target], {
          timeoutMs: 30_000,
          env: { PATH: SAFE_EXEC_PATH, GIT_CONFIG_NOSYSTEM: "1" },
        });
      }
      await runCommand("git", ["-C", shadowRepo, "worktree", "prune"], {
        timeoutMs: 30_000,
        env: { PATH: SAFE_EXEC_PATH, GIT_CONFIG_NOSYSTEM: "1" },
      });
      await removeOrphanedWorktreeDirectories(config, worktreeRoot);
    } else {
      await removeOrphanedWorktreeDirectories(config, worktreeRoot);
    }
  } finally {
    await cleanupRunContainers(config, worktreeRoot);
  }
}

async function removeOrphanedWorktreeDirectories(
  config: ResolvedRingerConfig,
  worktreeRoot: string,
): Promise<void> {
  let rootStat: import("node:fs").Stats;
  try {
    rootStat = await fs.lstat(worktreeRoot);
  } catch {
    return;
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    return;
  }
  const stateRoot = await fs.realpath(config.stateDir).catch(() => null);
  if (!stateRoot) {
    return;
  }
  let entries: Dirent[];
  try {
    entries = await fs.readdir(worktreeRoot, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "logs") {
      continue;
    }
    const taskdir = path.join(worktreeRoot, entry.name);
    try {
      const taskStat = await fs.lstat(taskdir);
      if (taskStat.isSymbolicLink() || !taskStat.isDirectory()) {
        continue;
      }
      if ((await fs.readdir(taskdir)).length === 0) {
        await fs.rm(taskdir, { recursive: true, force: true });
        continue;
      }
      const gitFile = path.join(taskdir, ".git");
      const gitStat = await fs.lstat(gitFile);
      if (gitStat.isSymbolicLink() || !gitStat.isFile()) {
        continue;
      }
      const marker = (await fs.readFile(gitFile, "utf8")).trim();
      const match = /^gitdir:\s*(.+)$/u.exec(marker);
      if (!match?.[1]) {
        continue;
      }
      const gitdir = path.resolve(path.dirname(gitFile), match[1]);
      if (!isPathWithin(stateRoot, gitdir)) {
        continue;
      }
      await fs.rm(taskdir, { recursive: true, force: true });
    } catch {
      // A disappearing or malformed task directory is left for the next
      // audited retention pass rather than deleting an ambiguous path.
    }
  }
}

async function cleanupRunContainers(
  config: ResolvedRingerConfig,
  worktreeRoot: string,
): Promise<void> {
  const deadline = Date.now() + CONTAINER_CLEANUP_DEADLINE_MS;
  for (
    let attempt = 0;
    attempt < CONTAINER_CLEANUP_ATTEMPTS && Date.now() < deadline;
    attempt += 1
  ) {
    const containers = await listLocalWorkerContainers(config);
    const owned = containers.filter((container) =>
      container.mountSources.some((source) => isPathWithin(worktreeRoot, source)),
    );
    if (owned.length === 0) {
      return;
    }
    for (const container of owned) {
      await runCommand("docker", ["rm", "-f", container.id], {
        timeoutMs: 15_000,
        env: dockerEnv(config),
      }).catch(() => {});
    }
    if (attempt + 1 < CONTAINER_CLEANUP_ATTEMPTS) {
      await new Promise((resolve) => {
        setTimeout(resolve, CONTAINER_CLEANUP_INTERVAL_MS);
      });
    }
  }
}

export async function pruneRetention(
  config: ResolvedRingerConfig,
  now = Date.now(),
): Promise<void> {
  const rawCutoff = now - config.rawRetentionDays * 86_400_000;
  if ((await findCorruptRunReceipts(config)).length > 0) {
    // Preserve all raw state until an operator can inspect the corrupt
    // receipt; pruning would destroy the evidence needed for recovery.
    return;
  }
  const activeRuns = (await readRunReceipts(config)).filter(
    (run) => run.status === "queued" || run.status === "running",
  );
  const activeRunIds = new Set(activeRuns.map((run) => run.runId));
  const activeSnapshotIds = new Set(activeRuns.map((run) => run.snapshotId));
  const activeManifestDigests = new Set(activeRuns.map((run) => run.manifestSha256));
  const activeNativeRunIds = new Set(
    activeRuns.flatMap((run) => (run.nativeRunId ? [run.nativeRunId] : [])),
  );
  const activeNativeRunFiles = new Set(
    activeRuns.flatMap((run) => (run.nativeRunId ? [`${run.nativeRunId}.json`] : [])),
  );
  const retentionRoots: Array<{
    root: string;
    protectedNames: Set<string>;
  }> = [
    { root: path.join(config.stateDir, "runs"), protectedNames: activeRunIds },
    {
      root: path.join(config.stateDir, "preparations"),
      protectedNames: activeManifestDigests,
    },
    { root: path.join(config.stateDir, "snapshots"), protectedNames: activeSnapshotIds },
    {
      root: path.join(config.stateDir, "upstream", "runs"),
      protectedNames: activeNativeRunFiles,
    },
    {
      root: path.join(config.stateDir, "upstream", "artifacts", "deliverables"),
      protectedNames: activeNativeRunIds,
    },
    {
      root: path.join(config.stateDir, "upstream", "artifacts", "versions"),
      protectedNames: activeNativeRunIds,
    },
  ];
  for (const { root, protectedNames } of retentionRoots) {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isFile()) {
        continue;
      }
      if (protectedNames.has(entry.name)) {
        continue;
      }
      const target = path.join(root, entry.name);
      const stat = await fs.stat(target);
      if (stat.mtimeMs < rawCutoff) {
        await fs.rm(target, { recursive: entry.isDirectory(), force: true });
      }
    }
  }
  if (activeRuns.length === 0) {
    await pruneEvalJsonl(config, rawCutoff);
  }
  const receiptCutoff = now - config.receiptRetentionDays * 86_400_000;
  const receiptsRoot = path.join(config.stateDir, "receipts");
  let receipts: string[] = [];
  try {
    receipts = await fs.readdir(receiptsRoot);
  } catch {}
  for (const name of receipts.filter((item) => /^run-[a-f0-9-]+\.json$/u.test(item))) {
    if (activeRunIds.has(name.slice(0, -5))) {
      continue;
    }
    const target = path.join(receiptsRoot, name);
    const stat = await fs.stat(target);
    if (stat.mtimeMs < receiptCutoff) {
      await fs.rm(target, { force: true });
    }
  }
}

async function pruneEvalJsonl(config: ResolvedRingerConfig, cutoff: number): Promise<void> {
  const file = path.join(config.stateDir, "upstream", "runs.jsonl");
  let source: string;
  try {
    source = await fs.readFile(file, "utf8");
  } catch {
    return;
  }
  const retained: string[] = [];
  for (const line of source.split(/\r?\n/u).filter(Boolean)) {
    try {
      // SAFETY: JSONL rows are read only for the optional timestamp field used by retention.
      const row = JSON.parse(line) as { logged_at?: unknown };
      const timestamp = typeof row.logged_at === "string" ? Date.parse(row.logged_at) : Number.NaN;
      if (!Number.isFinite(timestamp) || timestamp >= cutoff) {
        retained.push(line);
      }
    } catch {
      retained.push(line);
    }
  }
  if (retained.length === source.split(/\r?\n/u).filter(Boolean).length) {
    return;
  }
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, retained.length > 0 ? `${retained.join("\n")}\n` : "", {
    mode: 0o600,
  });
  await fs.rename(temp, file);
  await fs.chmod(file, 0o600);
}

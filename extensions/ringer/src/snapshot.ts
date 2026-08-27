// SAFETY-RATCHET: template-aware
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { sha256Bytes } from "./crypto.js";
import { commandFailure, runCommand, SAFE_EXEC_PATH } from "./process.js";
import { assertSnapshotStorage, writeJsonPrivate } from "./snapshot-storage.js";
import type { WorkspaceState } from "./snapshot-types.js";
import type {
  ResolvedRingerConfig,
  RingerRepositoryPolicy,
  RingerSnapshotReceipt,
} from "./types.js";

const SENSITIVE_PATH_PART =
  /(?:^|[._-])(api[_-]?key|credential|private[_-]?key|secret|token)(?:[._-]|$)/iu;
const HIDDEN_CREDENTIAL_NAMES = new Set([".env", ".npmrc", ".pypirc", ".netrc"]);

function assertSha(value: string, label: string): void {
  if (!/^[a-f0-9]{40}$/u.test(value)) {
    throw new Error(`${label} must be an exact 40-character Git SHA.`);
  }
}

function normalizeRepoRelativePath(raw: string): string {
  if (!raw || raw.includes("\0") || path.isAbsolute(raw)) {
    throw new Error(`Untracked path must be a non-empty repository-relative path: ${raw}`);
  }
  const normalized = path.posix.normalize(raw.replaceAll("\\", "/"));
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`Untracked path escapes the repository: ${raw}`);
  }
  if (normalized === ".git" || normalized.startsWith(".git/")) {
    throw new Error("The .git directory cannot be included in a snapshot.");
  }
  return normalized;
}

function isSensitiveUntrackedPath(relativePath: string): boolean {
  const parts = relativePath.split("/");
  return parts.some(
    (part) =>
      HIDDEN_CREDENTIAL_NAMES.has(part.toLowerCase()) ||
      part.toLowerCase().startsWith(".env.") ||
      SENSITIVE_PATH_PART.test(part),
  );
}

async function git(
  repo: string,
  args: string[],
  options?: { input?: Buffer; env?: NodeJS.ProcessEnv },
): Promise<Buffer> {
  const result = await runCommand("git", ["-C", repo, ...args], {
    input: options?.input,
    timeoutMs: 120_000,
    env: {
      PATH: SAFE_EXEC_PATH,
      LANG: "C",
      LC_ALL: "C",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: os.devNull,
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
      ...options?.env,
    },
  });
  if (result.code !== 0) {
    throw commandFailure("git", ["-C", repo, ...args], result);
  }
  return result.stdout;
}

async function resolveCanonicalRepo(repo: string): Promise<string> {
  const candidate = path.resolve(repo);
  const root = (await git(candidate, ["rev-parse", "--show-toplevel"])).toString("utf8").trim();
  const canonicalCandidate = await fs.realpath(candidate);
  const canonicalRoot = await fs.realpath(root);
  if (canonicalCandidate !== canonicalRoot) {
    throw new Error(`Repository path must be the canonical Git root: ${canonicalRoot}`);
  }
  return canonicalRoot;
}

export async function resolveRepositoryPolicy(
  config: ResolvedRingerConfig,
  repo: string,
): Promise<{ repo: string; policy: RingerRepositoryPolicy }> {
  const canonicalRepo = await resolveCanonicalRepo(repo);
  for (const policy of config.allowedRepositories) {
    let canonicalPolicyRoot: string;
    try {
      canonicalPolicyRoot = await fs.realpath(policy.root);
    } catch {
      continue;
    }
    if (canonicalPolicyRoot === canonicalRepo) {
      return { repo: canonicalRepo, policy };
    }
  }
  throw new Error(`Repository is not allowlisted for Local AI Assist: ${canonicalRepo}`);
}

export type { WorkspaceState } from "./snapshot-types.js";

async function assertContainedSymlink(repo: string, relativePath: string): Promise<void> {
  const canonicalRepo = await fs.realpath(repo);
  const prefix = canonicalRepo.endsWith(path.sep) ? canonicalRepo : `${canonicalRepo}${path.sep}`;
  let current = repo;
  for (const segment of relativePath.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    current = path.join(current, segment);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      // SAFETY: Node filesystem errors expose the documented errno code property.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }
    if (stat.isSymbolicLink()) {
      let target: string;
      try {
        target = await fs.realpath(current);
      } catch (error) {
        // SAFETY: Node filesystem errors expose the documented errno code property.
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new Error(`Snapshot symlink is broken: ${relativePath}`, { cause: error });
        }
        throw error;
      }
      if (target !== canonicalRepo && !target.startsWith(prefix)) {
        throw new Error(`Snapshot symlink resolves outside the repository: ${relativePath}`);
      }
    }
  }
}

async function assertSymlinkTargetContained(
  repo: string,
  relativePath: string,
  target: string,
): Promise<void> {
  if (!target || target.includes("\0")) {
    throw new Error(`Snapshot symlink has an invalid target: ${relativePath}`);
  }
  const canonicalRepo = await fs.realpath(repo);
  const prefix = canonicalRepo.endsWith(path.sep) ? canonicalRepo : `${canonicalRepo}${path.sep}`;
  const resolved = path.resolve(repo, path.dirname(relativePath), target);
  if (resolved !== canonicalRepo && !resolved.startsWith(prefix)) {
    throw new Error(`Snapshot symlink resolves outside the repository: ${relativePath}`);
  }
}

async function readWorkspaceState(params: {
  repo: string;
  expectedHeadSha: string;
  includeUntrackedPaths: string[];
  maxBytes: number;
}): Promise<WorkspaceState> {
  assertSha(params.expectedHeadSha, "expectedHeadSha");
  const baseSha = (await git(params.repo, ["rev-parse", "HEAD"])).toString("utf8").trim();
  if (baseSha !== params.expectedHeadSha) {
    throw new Error(
      `Repository HEAD drifted: expected ${params.expectedHeadSha}, found ${baseSha}.`,
    );
  }
  try {
    await fs.access(path.join(params.repo, ".gitmodules"));
    throw new Error("Repositories with submodules are not supported in Local AI Assist v1.");
  } catch (error) {
    if (error instanceof Error && error.message.includes("submodules")) {
      throw error;
    }
  }

  const diff = await git(params.repo, [
    "diff",
    "--binary",
    "--full-index",
    "--no-ext-diff",
    "--no-textconv",
    "HEAD",
    "--",
  ]);
  const numstat = (await git(params.repo, ["diff", "--numstat", "HEAD", "--"])).toString("utf8");
  if (numstat.split("\n").some((line) => line.startsWith("-\t-\t"))) {
    throw new Error("Binary tracked changes are not supported in Local AI Assist v1.");
  }
  const trackedIndex = (await git(params.repo, ["ls-files", "-s", "-z"]))
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  for (const entry of trackedIndex) {
    const match = /^(\d{6}) ([a-f0-9]{40,64}) \d\t(.+)$/u.exec(entry);
    if (match?.[1] === "160000") {
      throw new Error("Repositories with submodules are not supported in Local AI Assist v1.");
    }
    if (match?.[1] === "120000" && match[2] && match[3]) {
      const target = (await git(params.repo, ["cat-file", "blob", match[2]])).toString("utf8");
      await assertSymlinkTargetContained(params.repo, match[3], target);
      await assertContainedSymlink(params.repo, match[3]);
    }
  }
  const trackedPaths = (await git(params.repo, ["ls-files", "-z"]))
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  for (const relativePath of trackedPaths) {
    try {
      await assertContainedSymlink(params.repo, relativePath);
    } catch (error) {
      // SAFETY: Node filesystem errors expose the documented errno code property.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
  const treeEntries = (await git(params.repo, ["ls-tree", "-r", "-l", "-z", baseSha]))
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  let trackedBytes = 0;
  for (const entry of treeEntries) {
    const tab = entry.indexOf("\t");
    const fields = (tab < 0 ? entry : entry.slice(0, tab)).split(" ");
    if (fields[1] === "commit") {
      throw new Error("Repositories with submodules are not supported in Local AI Assist v1.");
    }
    if (fields[0] === "120000" && fields[1] === "blob" && fields[2]) {
      const relativePath = entry.slice(tab + 1);
      const target = (await git(params.repo, ["cat-file", "blob", fields[2]])).toString("utf8");
      await assertSymlinkTargetContained(params.repo, relativePath, target);
    }
    if (fields[1] !== "blob") {
      continue;
    }
    const size = Number(fields[3]);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error("Unable to estimate tracked snapshot storage safely.");
    }
    trackedBytes += size;
  }
  const availableUntracked = new Set(
    (await git(params.repo, ["ls-files", "--others", "--exclude-standard", "-z"]))
      .toString("utf8")
      .split("\0")
      .filter(Boolean),
  );
  const requested = [
    ...new Set(params.includeUntrackedPaths.map((item) => normalizeRepoRelativePath(item))),
  ].toSorted();
  const untrackedContents = new Map<string, Buffer>();
  const untrackedModes = new Map<string, number>();
  let totalBytes = diff.byteLength;
  for (const relativePath of requested) {
    if (!availableUntracked.has(relativePath)) {
      throw new Error(
        `Requested untracked path is missing, ignored, or already tracked: ${relativePath}`,
      );
    }
    if (isSensitiveUntrackedPath(relativePath)) {
      throw new Error(`Sensitive-looking untracked path cannot enter a snapshot: ${relativePath}`);
    }
    await assertContainedSymlink(params.repo, relativePath);
    const stat = await fs.lstat(path.join(params.repo, relativePath));
    if (!stat.isFile()) {
      throw new Error(`Only regular untracked files can enter a snapshot: ${relativePath}`);
    }
    const content = await fs.readFile(path.join(params.repo, relativePath));
    if (content.includes(0)) {
      throw new Error(
        `Binary untracked content is not supported in Local AI Assist v1: ${relativePath}`,
      );
    }
    totalBytes += content.byteLength;
    if (totalBytes > params.maxBytes) {
      throw new Error(`Snapshot overlay exceeds the ${params.maxBytes}-byte policy limit.`);
    }
    untrackedContents.set(relativePath, content);
    untrackedModes.set(relativePath, stat.mode & 0o777);
  }
  if (totalBytes > params.maxBytes) {
    throw new Error(`Snapshot overlay exceeds the ${params.maxBytes}-byte policy limit.`);
  }

  const overlayPieces: Array<string | Buffer> = [baseSha, "\0", diff];
  for (const [relativePath, content] of untrackedContents) {
    overlayPieces.push(
      "\0",
      relativePath,
      "\0",
      String(untrackedModes.get(relativePath) ?? 0o644),
      "\0",
      sha256Bytes(content),
    );
  }
  const overlaySha256 = sha256Bytes(
    Buffer.concat(overlayPieces.map((piece) => Buffer.from(piece))),
  );
  const workspaceDigest = sha256Bytes(
    `${params.repo}\n${baseSha}\n${overlaySha256}\n${requested.join("\n")}`,
  );
  return {
    baseSha,
    diff,
    trackedBytes,
    overlaySha256,
    workspaceDigest,
    includedUntrackedPaths: requested,
    excludedPaths: [...availableUntracked].filter((item) => !requested.includes(item)).toSorted(),
    untrackedContents,
    untrackedModes,
  };
}

/**
 * A workspace can change while the initial Git/read pass is in progress. Keep
 * the immutable snapshot fail-closed by comparing the exact bytes and modes
 * that were captured with one final read before materializing the shadow tree.
 */
export async function assertWorkspaceStable(params: {
  repo: string;
  baseSha: string;
  diff: Buffer;
  includedUntrackedPaths: string[];
  untrackedContents: ReadonlyMap<string, Buffer>;
  untrackedModes: ReadonlyMap<string, number>;
}): Promise<void> {
  const finalBaseSha = (await git(params.repo, ["rev-parse", "HEAD"])).toString("utf8").trim();
  if (finalBaseSha !== params.baseSha) {
    throw new Error("Repository HEAD changed during snapshot capture.");
  }
  const finalDiff = await git(params.repo, [
    "diff",
    "--binary",
    "--full-index",
    "--no-ext-diff",
    "--no-textconv",
    "HEAD",
    "--",
  ]);
  if (!finalDiff.equals(params.diff)) {
    throw new Error("Repository tracked content changed during snapshot capture.");
  }
  for (const relativePath of params.includedUntrackedPaths) {
    const target = path.join(params.repo, relativePath);
    const stat = await fs.lstat(target);
    const expectedMode = params.untrackedModes.get(relativePath);
    const expectedContent = params.untrackedContents.get(relativePath);
    if (
      !stat.isFile() ||
      expectedMode === undefined ||
      (stat.mode & 0o777) !== expectedMode ||
      expectedContent === undefined ||
      !(await fs.readFile(target)).equals(expectedContent)
    ) {
      throw new Error(
        `Repository untracked content changed during snapshot capture: ${relativePath}`,
      );
    }
  }
}

async function initializeImmutableGitSnapshot(params: {
  sourceRepo: string;
  baseSha: string;
  shadowRepo: string;
}): Promise<void> {
  // Fetch through the file transport with depth one. This copies the exact
  // base commit and tree into the retained snapshot without hardlinks or a
  // dependency on the user repository after preparation completes.
  await git(params.shadowRepo, ["init", "-q"]);
  await git(params.shadowRepo, [
    "fetch",
    "--depth=1",
    "--no-tags",
    "--no-write-fetch-head",
    pathToFileURL(params.sourceRepo).href,
    params.baseSha,
  ]);
  await git(params.shadowRepo, ["update-ref", "refs/heads/main", params.baseSha]);
  await git(params.shadowRepo, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  // Keep the snapshot repository's own worktree empty. Ringer creates each
  // disposable task worktree from this immutable object store, so the base
  // tree is checked out exactly once per task instead of once per snapshot
  // plus once per task.
  await git(params.shadowRepo, ["config", "core.bare", "true"]);
  await fs.rm(path.join(params.shadowRepo, ".git", "FETCH_HEAD"), { force: true });
}

async function writeWorkspaceCommit(params: {
  shadowRepo: string;
  snapshotRoot: string;
  baseSha: string;
  diff: Buffer;
  untrackedContents: ReadonlyMap<string, Buffer>;
  untrackedModes: ReadonlyMap<string, number>;
  workspaceDigest: string;
}): Promise<string> {
  const indexPath = path.join(params.snapshotRoot, "workspace.index");
  const indexEnv = { GIT_INDEX_FILE: indexPath };
  try {
    await git(params.shadowRepo, ["read-tree", params.baseSha], { env: indexEnv });
    if (params.diff.byteLength > 0) {
      await git(params.shadowRepo, ["apply", "--cached", "--binary", "--whitespace=nowarn", "-"], {
        input: params.diff,
        env: indexEnv,
      });
    }
    for (const [relativePath, content] of params.untrackedContents) {
      const blobSha = (
        await git(params.shadowRepo, ["hash-object", "-w", "--stdin"], { input: content })
      )
        .toString("utf8")
        .trim();
      if (!/^[a-f0-9]{40,64}$/u.test(blobSha)) {
        throw new Error(`Git returned an invalid blob ID for ${relativePath}.`);
      }
      const mode = (params.untrackedModes.get(relativePath) ?? 0o644).toString(8);
      await git(
        params.shadowRepo,
        ["update-index", "--add", "--cacheinfo", `${mode},${blobSha},${relativePath}`],
        { env: indexEnv },
      );
    }
    const treeSha = (await git(params.shadowRepo, ["write-tree"], { env: indexEnv }))
      .toString("utf8")
      .trim();
    if (!/^[a-f0-9]{40,64}$/u.test(treeSha)) {
      throw new Error("Git returned an invalid workspace tree ID.");
    }
    const sourceSha = (
      await git(params.shadowRepo, ["commit-tree", treeSha, "-p", params.baseSha], {
        input: Buffer.from(
          `Local AI Assist snapshot ${params.workspaceDigest.slice(0, 12)}\n`,
          "utf8",
        ),
        env: {
          GIT_AUTHOR_NAME: "Local AI Assist",
          GIT_AUTHOR_EMAIL: "local-ai-assist@localhost",
          GIT_COMMITTER_NAME: "Local AI Assist",
          GIT_COMMITTER_EMAIL: "local-ai-assist@localhost",
        },
      })
    )
      .toString("utf8")
      .trim();
    if (!/^[a-f0-9]{40,64}$/u.test(sourceSha)) {
      throw new Error("Git returned an invalid workspace commit ID.");
    }
    await git(params.shadowRepo, ["update-ref", "refs/heads/main", sourceSha]);
    return sourceSha;
  } finally {
    await fs.rm(indexPath, { force: true });
  }
}

export async function prepareShadowSnapshot(params: {
  config: ResolvedRingerConfig;
  repo: string;
  expectedHeadSha: string;
  includeUntrackedPaths?: string[];
  now?: Date;
}): Promise<RingerSnapshotReceipt> {
  const { repo } = await resolveRepositoryPolicy(params.config, params.repo);
  const state = await readWorkspaceState({
    repo,
    expectedHeadSha: params.expectedHeadSha,
    includeUntrackedPaths: params.includeUntrackedPaths ?? [],
    maxBytes: params.config.maxSnapshotBytes,
  });
  await assertWorkspaceStable({
    repo,
    baseSha: state.baseSha,
    diff: state.diff,
    includedUntrackedPaths: state.includedUntrackedPaths,
    untrackedContents: state.untrackedContents,
    untrackedModes: state.untrackedModes,
  });
  const snapshotId = `snap-${state.workspaceDigest.slice(0, 24)}`;
  const snapshotRoot = path.join(params.config.stateDir, "snapshots", snapshotId);
  const shadowRepo = path.join(snapshotRoot, "repo");
  const receiptPath = path.join(snapshotRoot, "receipt.json");
  try {
    // SAFETY: A matching receipt is validated by loadSnapshot before reuse.
    const existing = JSON.parse(await fs.readFile(receiptPath, "utf8")) as RingerSnapshotReceipt;
    if (existing.workspaceDigest === state.workspaceDigest && existing.repo === repo) {
      try {
        const loaded = await loadSnapshot(params.config, snapshotId);
        // Rebuild snapshots created by the pre-object-store implementation so
        // a retained legacy checkout cannot recreate the storage amplification
        // this path is designed to prevent.
        const isBare =
          (await git(loaded.shadowRepo, ["rev-parse", "--is-bare-repository"]))
            .toString("utf8")
            .trim() === "true";
        if (isBare) {
          return loaded;
        }
      } catch {
        // A stale or incomplete snapshot is rebuilt below.
      }
    }
  } catch {
    // A missing or incomplete snapshot is rebuilt below.
  }

  await assertSnapshotStorage({
    config: params.config,
    state,
    replaceSnapshotRoot: snapshotRoot,
  });
  await fs.rm(snapshotRoot, { recursive: true, force: true });
  await fs.mkdir(snapshotRoot, { recursive: true, mode: 0o700 });
  await fs.chmod(snapshotRoot, 0o700);
  await fs.mkdir(shadowRepo, { recursive: true, mode: 0o700 });
  await initializeImmutableGitSnapshot({
    sourceRepo: repo,
    baseSha: state.baseSha,
    shadowRepo,
  });
  let sourceSha = state.baseSha;
  if (state.diff.byteLength > 0 || state.untrackedContents.size > 0) {
    sourceSha = await writeWorkspaceCommit({
      shadowRepo,
      snapshotRoot,
      baseSha: state.baseSha,
      diff: state.diff,
      untrackedContents: state.untrackedContents,
      untrackedModes: state.untrackedModes,
      workspaceDigest: state.workspaceDigest,
    });
  }

  const now = params.now ?? new Date();
  const receipt: RingerSnapshotReceipt = {
    snapshotId,
    repo,
    shadowRepo,
    baseSha: state.baseSha,
    sourceSha,
    workspaceDigest: state.workspaceDigest,
    overlaySha256: state.overlaySha256,
    includedUntrackedPaths: state.includedUntrackedPaths,
    excludedPaths: state.excludedPaths,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  };
  await writeJsonPrivate(receiptPath, receipt);
  return receipt;
}

export async function loadSnapshot(
  config: ResolvedRingerConfig,
  snapshotId: string,
  now = new Date(),
): Promise<RingerSnapshotReceipt> {
  if (!/^snap-[a-f0-9]{24}$/u.test(snapshotId)) {
    throw new Error("Invalid snapshot ID.");
  }
  const snapshotsRoot = path.join(config.stateDir, "snapshots");
  const snapshotRoot = path.join(snapshotsRoot, snapshotId);
  const receiptPath = path.join(snapshotRoot, "receipt.json");
  for (const [directory, label] of [
    [config.stateDir, "stateDir"],
    [snapshotsRoot, "snapshot root"],
    [snapshotRoot, "snapshot directory"],
  ] as const) {
    const stat = await fs.lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Snapshot ${label} must be a real directory.`);
    }
  }
  const receiptStat = await fs.lstat(receiptPath);
  if (!receiptStat.isFile() || receiptStat.isSymbolicLink() || (receiptStat.mode & 0o077) !== 0) {
    throw new Error("Snapshot receipt must be a private regular file.");
  }
  // SAFETY: Snapshot receipt identity and digests are validated immediately below.
  const receipt = JSON.parse(await fs.readFile(receiptPath, "utf8")) as RingerSnapshotReceipt;
  if (receipt.snapshotId !== snapshotId) {
    throw new Error("Snapshot receipt identity mismatch.");
  }
  assertSha(receipt.baseSha, "Snapshot baseSha");
  assertSha(receipt.sourceSha, "Snapshot sourceSha");
  if (
    !/^[a-f0-9]{64}$/u.test(receipt.workspaceDigest) ||
    !/^[a-f0-9]{64}$/u.test(receipt.overlaySha256)
  ) {
    throw new Error("Snapshot receipt digest is invalid.");
  }
  const expiresAt = Date.parse(receipt.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt < now.getTime()) {
    throw new Error(`Snapshot expired at ${receipt.expiresAt}.`);
  }
  const expectedShadowRepo = path.join(snapshotRoot, "repo");
  if (path.resolve(receipt.shadowRepo) !== path.resolve(expectedShadowRepo)) {
    throw new Error("Snapshot shadow repository escaped its retained state directory.");
  }
  const shadowStat = await fs.lstat(expectedShadowRepo);
  if (shadowStat.isSymbolicLink() || !shadowStat.isDirectory()) {
    throw new Error("Snapshot shadow repository must be a real directory.");
  }
  const realSnapshotRoot = await fs.realpath(snapshotRoot);
  if ((await fs.realpath(expectedShadowRepo)) !== path.join(realSnapshotRoot, "repo")) {
    throw new Error("Snapshot shadow repository resolved outside its retained state directory.");
  }
  const { repo } = await resolveRepositoryPolicy(config, receipt.repo);
  if (repo !== receipt.repo) {
    throw new Error("Snapshot repository identity is not canonical.");
  }
  const actualSha = (await git(receipt.shadowRepo, ["rev-parse", "HEAD"])).toString("utf8").trim();
  if (actualSha !== receipt.sourceSha) {
    throw new Error("Shadow snapshot HEAD drifted from its receipt.");
  }
  const isBare =
    (await git(receipt.shadowRepo, ["rev-parse", "--is-bare-repository"]))
      .toString("utf8")
      .trim() === "true";
  if (!isBare) {
    const dirty = (await git(receipt.shadowRepo, ["status", "--porcelain"]))
      .toString("utf8")
      .trim();
    if (dirty) {
      throw new Error("Shadow snapshot is no longer clean.");
    }
  }
  return receipt;
}

export async function computeCurrentWorkspaceDigest(params: {
  config: ResolvedRingerConfig;
  receipt: RingerSnapshotReceipt;
}): Promise<string> {
  const state = await readWorkspaceState({
    repo: params.receipt.repo,
    expectedHeadSha: params.receipt.baseSha,
    includeUntrackedPaths: params.receipt.includedUntrackedPaths,
    maxBytes: params.config.maxSnapshotBytes,
  });
  return state.workspaceDigest;
}

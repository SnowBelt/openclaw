import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertWorkspaceStable,
  computeCurrentWorkspaceDigest,
  loadSnapshot,
  prepareShadowSnapshot,
} from "./snapshot.js";
import type { ResolvedRingerConfig } from "./types.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

async function git(repo: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync("git", ["-C", repo, ...args]);
  return result.stdout.trim();
}

async function gitBytes(repo: string, ...args: string[]): Promise<Buffer> {
  const result = await execFileAsync("git", ["-C", repo, ...args], { encoding: "buffer" });
  return result.stdout;
}

async function fixture(): Promise<{ repo: string; config: ResolvedRingerConfig; head: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ringer-snapshot-test-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  await fs.mkdir(repo);
  await git(repo, "init", "-q");
  await fs.writeFile(path.join(repo, "tracked.txt"), "base\n");
  await git(repo, "add", "tracked.txt");
  await git(
    repo,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@localhost",
    "commit",
    "-qm",
    "base",
  );
  const head = await git(repo, "rev-parse", "HEAD");
  const config = {
    stateDir: path.join(root, "state"),
    maxParallel: 2,
    maxSnapshotBytes: 1024 * 1024,
    maxSnapshotStorageBytes: 1024 * 1024 * 1024,
    allowedRepositories: [{ root: repo, checkArgvPrefixes: [["node"]], models: [] }],
  } as unknown as ResolvedRingerConfig;
  return { repo, config, head };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("Local AI Assist immutable snapshots", () => {
  it("fails closed when the repository changes during snapshot capture", async () => {
    const { repo, head } = await fixture();
    await fs.writeFile(path.join(repo, "tracked.txt"), "dirty\n");
    await fs.writeFile(path.join(repo, "selected.txt"), "selected\n");
    const diff = await gitBytes(
      repo,
      "diff",
      "--binary",
      "--full-index",
      "--no-ext-diff",
      "--no-textconv",
      "HEAD",
      "--",
    );
    const expected = Buffer.from("selected\n");
    await fs.writeFile(path.join(repo, "tracked.txt"), "changed-after-read\n");
    await expect(
      assertWorkspaceStable({
        repo,
        baseSha: head,
        diff,
        includedUntrackedPaths: ["selected.txt"],
        untrackedContents: new Map([["selected.txt", expected]]),
        untrackedModes: new Map([["selected.txt", 0o644]]),
      }),
    ).rejects.toThrow(/tracked content changed/u);
  });

  it("captures dirty tracked and selected untracked content without mutating the source repo", async () => {
    const { repo, config, head } = await fixture();
    await fs.writeFile(path.join(repo, "tracked.txt"), "dirty\n");
    await fs.writeFile(path.join(repo, "selected.txt"), "selected\n");
    await fs.chmod(path.join(repo, "selected.txt"), 0o755);
    await fs.writeFile(path.join(repo, "excluded.txt"), "excluded\n");
    const receipt = await prepareShadowSnapshot({
      config,
      repo,
      expectedHeadSha: head,
      includeUntrackedPaths: ["selected.txt"],
    });
    const worktree = path.join(config.stateDir, "probe-worktree");
    await fs.mkdir(path.dirname(worktree), { recursive: true });
    await git(receipt.shadowRepo, "worktree", "add", "--detach", worktree, receipt.sourceSha);
    expect(await fs.readFile(path.join(worktree, "tracked.txt"), "utf8")).toBe("dirty\n");
    expect(await fs.readFile(path.join(worktree, "selected.txt"), "utf8")).toBe("selected\n");
    expect((await fs.stat(path.join(worktree, "selected.txt"))).mode & 0o777).toBe(0o755);
    await expect(fs.access(path.join(worktree, "excluded.txt"))).rejects.toThrow();
    expect(await git(receipt.shadowRepo, "rev-parse", "--is-bare-repository")).toBe("true");
    expect(await git(receipt.shadowRepo, "rev-list", "--all", "--count")).toBe("2");
    await expect(loadSnapshot(config, receipt.snapshotId)).resolves.toMatchObject({
      sourceSha: receipt.sourceSha,
    });
    await expect(
      prepareShadowSnapshot({
        config,
        repo,
        expectedHeadSha: head,
        includeUntrackedPaths: ["selected.txt"],
      }),
    ).resolves.toMatchObject({ snapshotId: receipt.snapshotId, sourceSha: receipt.sourceSha });
    expect(await git(repo, "rev-parse", "HEAD")).toBe(head);
    expect(await computeCurrentWorkspaceDigest({ config, receipt })).toBe(receipt.workspaceDigest);
    await fs.writeFile(path.join(repo, "tracked.txt"), "drift\n");
    expect(await computeCurrentWorkspaceDigest({ config, receipt })).not.toBe(
      receipt.workspaceDigest,
    );
  });

  it("materializes only the captured tree instead of cloning ignored workspace storage", async () => {
    const { repo, config } = await fixture();
    await fs.writeFile(path.join(repo, ".gitignore"), "node_modules/\n");
    await git(repo, "add", ".gitignore");
    await git(
      repo,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@localhost",
      "commit",
      "-qm",
      "ignore generated storage",
    );
    const currentHead = await git(repo, "rev-parse", "HEAD");
    const generated = path.join(repo, "node_modules", "generated-cache.bin");
    await fs.mkdir(path.dirname(generated), { recursive: true });
    await fs.writeFile(generated, Buffer.alloc(4 * 1024 * 1024, 7));

    const receipt = await prepareShadowSnapshot({
      config,
      repo,
      expectedHeadSha: currentHead,
    });

    const worktree = path.join(config.stateDir, "ignored-worktree");
    await fs.mkdir(path.dirname(worktree), { recursive: true });
    await git(receipt.shadowRepo, "worktree", "add", "--detach", worktree, receipt.sourceSha);
    await expect(fs.access(path.join(worktree, "node_modules"))).rejects.toThrow();
    await expect(fs.access(path.join(worktree, "generated-cache.bin"))).rejects.toThrow();
    await expect(fs.access(path.join(receipt.shadowRepo, "tracked.txt"))).rejects.toThrow();
    await expect(
      fs.access(path.join(receipt.shadowRepo, ".git", "objects", "info", "alternates")),
    ).rejects.toThrow();
    expect(receipt.baseSha).toBe(currentHead);
    expect(receipt.sourceSha).toBe(receipt.baseSha);
    expect(await git(receipt.shadowRepo, "rev-parse", "--is-bare-repository")).toBe("true");
    expect((await fs.stat(path.join(receipt.shadowRepo, ".git"))).isDirectory()).toBe(true);
    expect((await fs.stat(receipt.shadowRepo)).isDirectory()).toBe(true);
  });

  it("rejects a forged receipt that points outside retained snapshot state", async () => {
    const { repo, config, head } = await fixture();
    const receipt = await prepareShadowSnapshot({ config, repo, expectedHeadSha: head });
    const receiptPath = path.join(config.stateDir, "snapshots", receipt.snapshotId, "receipt.json");
    const forged = JSON.parse(await fs.readFile(receiptPath, "utf8"));
    forged.shadowRepo = repo;
    await fs.writeFile(receiptPath, `${JSON.stringify(forged)}\n`, { mode: 0o600 });
    await expect(loadSnapshot(config, receipt.snapshotId)).rejects.toThrow(/escaped/u);
  });

  it("rejects secret-like and binary untracked inputs", async () => {
    const { repo, config, head } = await fixture();
    await fs.writeFile(path.join(repo, ".env"), "TOKEN=secret\n");
    await expect(
      prepareShadowSnapshot({
        config,
        repo,
        expectedHeadSha: head,
        includeUntrackedPaths: [".env"],
      }),
    ).rejects.toThrow(/Sensitive-looking/u);
    await fs.writeFile(path.join(repo, "asset.bin"), Buffer.from([0, 1, 2]));
    await expect(
      prepareShadowSnapshot({
        config,
        repo,
        expectedHeadSha: head,
        includeUntrackedPaths: ["asset.bin"],
      }),
    ).rejects.toThrow(/Binary untracked/u);
  });

  it("rejects submodules, external symlinks, and oversized overlays", async () => {
    const submodule = await fixture();
    await fs.writeFile(path.join(submodule.repo, ".gitmodules"), '[submodule "x"]\n');
    await expect(
      prepareShadowSnapshot({
        config: submodule.config,
        repo: submodule.repo,
        expectedHeadSha: submodule.head,
      }),
    ).rejects.toThrow(/submodules/u);

    const symlink = await fixture();
    const outside = path.join(path.dirname(symlink.repo), "outside.txt");
    await fs.writeFile(outside, "outside\n");
    await fs.symlink(outside, path.join(symlink.repo, "escape.txt"));
    await expect(
      prepareShadowSnapshot({
        config: symlink.config,
        repo: symlink.repo,
        expectedHeadSha: symlink.head,
        includeUntrackedPaths: ["escape.txt"],
      }),
    ).rejects.toThrow(/outside the repository/u);

    const parentSymlink = await fixture();
    const parentOutside = path.join(path.dirname(parentSymlink.repo), "outside-dir");
    await fs.mkdir(parentOutside);
    await fs.mkdir(path.join(parentSymlink.repo, "nested"));
    await fs.writeFile(path.join(parentSymlink.repo, "nested", "selected.txt"), "inside\n");
    await git(parentSymlink.repo, "add", "nested/selected.txt");
    await git(
      parentSymlink.repo,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@localhost",
      "commit",
      "-qm",
      "nested",
    );
    parentSymlink.head = await git(parentSymlink.repo, "rev-parse", "HEAD");
    await fs.writeFile(path.join(parentOutside, "selected.txt"), "outside\n");
    await fs.rm(path.join(parentSymlink.repo, "nested"), { recursive: true });
    await fs.symlink(parentOutside, path.join(parentSymlink.repo, "nested"));
    await expect(
      prepareShadowSnapshot({
        config: parentSymlink.config,
        repo: parentSymlink.repo,
        expectedHeadSha: parentSymlink.head,
      }),
    ).rejects.toThrow(/outside the repository/u);

    const trackedSymlink = await fixture();
    const trackedOutside = path.join(path.dirname(trackedSymlink.repo), "tracked-outside.txt");
    await fs.writeFile(trackedOutside, "outside\n");
    await fs.rm(path.join(trackedSymlink.repo, "tracked.txt"));
    await fs.symlink(trackedOutside, path.join(trackedSymlink.repo, "tracked.txt"));
    await expect(
      prepareShadowSnapshot({
        config: trackedSymlink.config,
        repo: trackedSymlink.repo,
        expectedHeadSha: trackedSymlink.head,
      }),
    ).rejects.toThrow(/outside the repository/u);

    const deletedBaseSymlink = await fixture();
    const deletedBaseOutside = path.join(path.dirname(deletedBaseSymlink.repo), "deleted-outside");
    await fs.writeFile(deletedBaseOutside, "outside\n");
    await fs.rm(path.join(deletedBaseSymlink.repo, "tracked.txt"));
    await fs.symlink(deletedBaseOutside, path.join(deletedBaseSymlink.repo, "tracked.txt"));
    await git(deletedBaseSymlink.repo, "add", "tracked.txt");
    await git(
      deletedBaseSymlink.repo,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@localhost",
      "commit",
      "-qm",
      "external symlink",
    );
    deletedBaseSymlink.head = await git(deletedBaseSymlink.repo, "rev-parse", "HEAD");
    await fs.rm(path.join(deletedBaseSymlink.repo, "tracked.txt"));
    await expect(
      prepareShadowSnapshot({
        config: deletedBaseSymlink.config,
        repo: deletedBaseSymlink.repo,
        expectedHeadSha: deletedBaseSymlink.head,
      }),
    ).rejects.toThrow(/outside the repository/u);

    const oversized = await fixture();
    oversized.config.maxSnapshotBytes = 4;
    await fs.writeFile(path.join(oversized.repo, "large.txt"), "too-large\n");
    await expect(
      prepareShadowSnapshot({
        config: oversized.config,
        repo: oversized.repo,
        expectedHeadSha: oversized.head,
        includeUntrackedPaths: ["large.txt"],
      }),
    ).rejects.toThrow(/exceeds/u);
  });

  it("retains repository-internal symlinks while auditing snapshot storage", async () => {
    const internal = await fixture();
    await fs.writeFile(path.join(internal.repo, "AGENTS.md"), "inside\n");
    await fs.symlink("AGENTS.md", path.join(internal.repo, "CLAUDE.md"));
    await git(internal.repo, "add", "AGENTS.md", "CLAUDE.md");
    await git(
      internal.repo,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@localhost",
      "commit",
      "-qm",
      "internal symlink",
    );
    internal.head = await git(internal.repo, "rev-parse", "HEAD");
    const first = await prepareShadowSnapshot({
      config: internal.config,
      repo: internal.repo,
      expectedHeadSha: internal.head,
    });
    await fs.writeFile(path.join(internal.repo, "tracked.txt"), "dirty\n");
    const second = await prepareShadowSnapshot({
      config: internal.config,
      repo: internal.repo,
      expectedHeadSha: internal.head,
    });
    expect(second.snapshotId).not.toBe(first.snapshotId);
    const worktree = path.join(internal.config.stateDir, "symlink-worktree");
    await fs.mkdir(path.dirname(worktree), { recursive: true });
    await git(second.shadowRepo, "worktree", "add", "--detach", worktree, second.sourceSha);
    expect(await fs.realpath(path.join(worktree, "CLAUDE.md"))).toBe(
      await fs.realpath(path.join(worktree, "AGENTS.md")),
    );
  });

  it("fails closed before materializing a snapshot when storage policy is too small", async () => {
    const { repo, config, head } = await fixture();
    config.maxSnapshotStorageBytes = 1;
    await expect(prepareShadowSnapshot({ config, repo, expectedHeadSha: head })).rejects.toThrow(
      /storage estimate/u,
    );
  });

  it("includes retained snapshots in storage admission", async () => {
    const { repo, config, head } = await fixture();
    config.maxSnapshotStorageBytes = 65 * 1024 * 1024;
    const retained = path.join(config.stateDir, "snapshots", "previous");
    await fs.mkdir(retained, { recursive: true });
    await fs.writeFile(path.join(retained, "retained.bin"), Buffer.alloc(2 * 1024 * 1024));
    expect((await fs.stat(path.join(retained, "retained.bin"))).size).toBe(2 * 1024 * 1024);
    await expect(prepareShadowSnapshot({ config, repo, expectedHeadSha: head })).rejects.toThrow(
      /Retained snapshot storage/u,
    );
  });

  it("reserves free space for the configured number of disposable task worktrees", async () => {
    const { repo, config, head } = await fixture();
    await fs.mkdir(config.stateDir, { recursive: true });
    const stats = await fs.statfs(config.stateDir);
    const snapshotReserve = 64 * 1024 * 1024 + 8;
    const requiredBelowOneWorktree = snapshotReserve + 1 * 1024 * 1024 * 1024;
    vi.spyOn(fs, "statfs").mockResolvedValue(
      Object.assign(stats, { bavail: BigInt(requiredBelowOneWorktree), bsize: 1n }),
    );
    await expect(prepareShadowSnapshot({ config, repo, expectedHeadSha: head })).rejects.toThrow(
      /task worktree/u,
    );
  });
});

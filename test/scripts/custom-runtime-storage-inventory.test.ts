import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildCustomRuntimeStorageInventory } from "../../scripts/custom-runtime/custom-runtime-storage-inventory.js";
import { useAutoCleanupTempDirTracker } from "../helpers/temp-dir.js";

const temporaryDirectories = useAutoCleanupTempDirTracker(afterEach);

function withExecutableOnPath(name: string, source: string, run: () => void): void {
  const bin = temporaryDirectories.make("runtime-storage-bin-");
  const executable = path.join(bin, name);
  fs.writeFileSync(executable, source, { mode: 0o755 });
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ""}`;
  try {
    run();
  } finally {
    process.env.PATH = previousPath;
  }
}

function fakeGitSource(countObjectsOutput: string): string {
  return `#!/bin/sh
case "$3" in
  rev-parse)
    printf '.git\\n'
    ;;
  count-objects)
    cat <<'METRICS'
${countObjectsOutput}
METRICS
    ;;
  for-each-ref)
    printf 'refs/heads/main\\n'
    ;;
  worktree)
    printf 'worktree /tmp/source\\n'
    ;;
  *)
    printf 'unexpected git invocation: %s\\n' "$*" >&2
    exit 2
    ;;
esac
`;
}

function buildFixtureInventory(root: string, deadlineMs?: number) {
  const repository = path.join(root, "source");
  fs.mkdirSync(repository, { recursive: true });
  return buildCustomRuntimeStorageInventory({
    deadlineMs,
    evaluatedAt: new Date("2026-07-23T12:00:00Z"),
    releasesDirectory: path.join(root, "releases"),
    repository,
    runtimeHome: path.join(root, "runtime-home"),
    updateWorktreesDirectory: path.join(root, "updates"),
  });
}

describe("custom runtime storage inventory", () => {
  it("reports Git and every custom-runtime artifact class without mutation", () => {
    const root = fs.realpathSync(temporaryDirectories.make("runtime-storage-"));
    const repository = path.join(root, "source");
    const runtimeHome = path.join(root, "runtime-home");
    const releases = path.join(root, "releases");
    const updates = path.join(root, "updates");
    for (const directory of [
      repository,
      path.join(runtimeHome, "backups", "backup-one"),
      path.join(runtimeHome, "receipts"),
      path.join(runtimeHome, "rollbacks", "rollback-one"),
      path.join(releases, "release-one"),
      path.join(updates, "update-one"),
    ]) {
      fs.mkdirSync(directory, { recursive: true });
    }
    expect(spawnSync("git", ["init", "-q", repository]).status).toBe(0);
    expect(
      spawnSync("git", ["-C", repository, "config", "user.email", "test@example.invalid"]).status,
    ).toBe(0);
    expect(spawnSync("git", ["-C", repository, "config", "user.name", "Test"]).status).toBe(0);
    fs.writeFileSync(path.join(repository, "README.md"), "source\n");
    expect(spawnSync("git", ["-C", repository, "add", "README.md"]).status).toBe(0);
    expect(spawnSync("git", ["-C", repository, "commit", "-qm", "source"]).status).toBe(0);
    fs.writeFileSync(path.join(runtimeHome, "receipts", "receipt.json"), "{}\n");
    fs.writeFileSync(path.join(runtimeHome, "backups", "pointer.json"), "{}\n");
    fs.writeFileSync(path.join(releases, "release-one", "runtime.bin"), "runtime\n");

    const before = fs.readdirSync(releases).toSorted();
    const first = buildCustomRuntimeStorageInventory({
      evaluatedAt: new Date("2026-07-23T12:00:00Z"),
      releasesDirectory: releases,
      repository,
      runtimeHome,
      updateWorktreesDirectory: updates,
    });
    const second = buildCustomRuntimeStorageInventory({
      evaluatedAt: new Date("2026-07-23T12:00:00Z"),
      releasesDirectory: releases,
      repository,
      runtimeHome,
      updateWorktreesDirectory: updates,
    });

    expect(second).toEqual(first);
    expect(first.mode).toBe("read_only");
    expect(first.artifactCounts).toEqual({
      backups: 2,
      receipts: 1,
      releases: 1,
      rollbackBundles: 1,
      updateWorktrees: 1,
    });
    expect(first.git.worktrees).toBe(1);
    expect(first.git.refs).toBeGreaterThanOrEqual(1);
    expect(first.git.measurementStatus).toBe("measured");
    expect(first.git.garbageObjects).toBeGreaterThanOrEqual(0);
    expect(first.trees.releases.measurementStatus).toBe("measured");
    expect(first.trees.releases.physicalBytes ?? 0).toBeGreaterThan(0);
    expect(first.inventoryHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(fs.readdirSync(releases).toSorted()).toEqual(before);
  });

  it.each([
    {
      expected: "git count-objects is missing required metric: size-garbage",
      metrics: "count: 1\nsize: 2\nin-pack: 3\nsize-pack: 4\ngarbage: 0",
      name: "missing",
    },
    {
      expected: "git count-objects returned invalid numeric metric size: unknown",
      metrics: "count: 1\nsize: unknown\nin-pack: 3\nsize-pack: 4\ngarbage: 0\nsize-garbage: 0",
      name: "invalid",
    },
  ])("fails closed when a required Git metric is $name", ({ expected, metrics }) => {
    const root = fs.realpathSync(temporaryDirectories.make("runtime-storage-invalid-git-"));
    withExecutableOnPath("git", fakeGitSource(metrics), () => {
      expect(() => buildFixtureInventory(root)).toThrow(expected);
    });
  });

  it("fails closed when a bounded Git subprocess exhausts the global deadline", () => {
    const root = fs.realpathSync(temporaryDirectories.make("runtime-storage-timeout-"));
    withExecutableOnPath(
      "git",
      `#!/bin/sh
while :; do
  :
done
`,
      () => {
        expect(() => buildFixtureInventory(root, 50)).toThrow(
          "storage inventory deadline exceeded while running git rev-parse --git-dir",
        );
      },
    );
  });
});

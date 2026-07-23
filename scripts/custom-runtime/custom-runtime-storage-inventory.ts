import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

export type StorageTreeMetrics = {
  exists: boolean;
  measurementStatus: "measured" | "missing" | "timed_out";
  physicalBytes: number | null;
  root: string;
};

export type CustomRuntimeStorageInventory = {
  artifactCounts: {
    backups: number;
    receipts: number;
    releases: number;
    rollbackBundles: number;
    updateWorktrees: number;
  };
  evaluatedAt: string;
  git: {
    garbageBytes: number;
    garbageObjects: number;
    looseObjectBytes: number;
    looseObjects: number;
    measurementStatus: "measured";
    packedObjectBytes: number;
    packedObjects: number;
    refs: number;
    repository: string;
    worktrees: number;
  };
  inventoryHash: string;
  mode: "read_only";
  schema: "openclaw.custom-runtime-storage-inventory.v1";
  trees: {
    backups: StorageTreeMetrics;
    receipts: StorageTreeMetrics;
    releases: StorageTreeMetrics;
    rollbacks: StorageTreeMetrics;
    updateWorktrees: StorageTreeMetrics;
  };
};

type BuildStorageInventoryOptions = {
  deadlineMs?: number;
  evaluatedAt?: Date;
  releasesDirectory: string;
  repository: string;
  runtimeHome: string;
  updateWorktreesDirectory: string;
};

type StorageInventoryDeadline = {
  expiresAt: number;
};

const DEFAULT_GLOBAL_DEADLINE_MS = 30_000;
const MAX_SUBPROCESS_TIMEOUT_MS = 15_000;
const REQUIRED_COUNT_OBJECT_METRICS = [
  "count",
  "size",
  "in-pack",
  "size-pack",
  "garbage",
  "size-garbage",
] as const;

type CountObjectMetric = (typeof REQUIRED_COUNT_OBJECT_METRICS)[number];
type CountObjectMetrics = Record<CountObjectMetric, number>;

function createDeadline(deadlineMs = DEFAULT_GLOBAL_DEADLINE_MS): StorageInventoryDeadline {
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0) {
    throw new Error("deadlineMs must be a positive safe integer");
  }
  return { expiresAt: performance.now() + deadlineMs };
}

function remainingDeadlineMs(deadline: StorageInventoryDeadline): number {
  return Math.max(0, Math.ceil(deadline.expiresAt - performance.now()));
}

function requireRemainingDeadlineMs(deadline: StorageInventoryDeadline, operation: string): number {
  const remaining = remainingDeadlineMs(deadline);
  if (remaining === 0) {
    throw new Error(`storage inventory deadline exceeded before ${operation}`);
  }
  return remaining;
}

function isTimeoutError(error: Error | undefined): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
}

function kibibytesToBytes(value: number, label: string): number {
  const bytes = value * 1024;
  if (!Number.isSafeInteger(bytes)) {
    throw new Error(`${label} exceeds the safe integer byte range`);
  }
  return bytes;
}

function scanTree(root: string, deadline: StorageInventoryDeadline): StorageTreeMetrics {
  const resolved = path.resolve(root);
  if (!fs.existsSync(resolved)) {
    return {
      exists: false,
      measurementStatus: "missing",
      physicalBytes: 0,
      root: resolved,
    };
  }
  const remaining = remainingDeadlineMs(deadline);
  if (remaining === 0) {
    return {
      exists: true,
      measurementStatus: "timed_out",
      physicalBytes: null,
      root: resolved,
    };
  }
  const result = spawnSync("du", ["-sk", resolved], {
    encoding: "utf8",
    timeout: Math.min(MAX_SUBPROCESS_TIMEOUT_MS, remaining),
  });
  if (isTimeoutError(result.error) || remainingDeadlineMs(deadline) === 0) {
    return {
      exists: true,
      measurementStatus: "timed_out",
      physicalBytes: null,
      root: resolved,
    };
  }
  if (result.error) {
    throw new Error(`du failed for ${resolved}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `du failed for ${resolved}`);
  }
  const kibibytes = Number(result.stdout.trim().split(/\s+/u)[0]);
  if (!Number.isSafeInteger(kibibytes) || kibibytes < 0) {
    throw new Error(`du returned an invalid size for ${resolved}`);
  }
  return {
    exists: true,
    measurementStatus: "measured",
    physicalBytes: kibibytesToBytes(kibibytes, `du size for ${resolved}`),
    root: resolved,
  };
}

function gitOutput(repository: string, args: string[], deadline: StorageInventoryDeadline): string {
  const command = `git ${args.join(" ")}`;
  const remaining = requireRemainingDeadlineMs(deadline, command);
  const result = spawnSync("git", ["-C", repository, ...args], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: Math.min(MAX_SUBPROCESS_TIMEOUT_MS, remaining),
  });
  if (isTimeoutError(result.error) || remainingDeadlineMs(deadline) === 0) {
    throw new Error(`storage inventory deadline exceeded while running ${command}`);
  }
  if (result.error) {
    throw new Error(`${command} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `${command} failed`);
  }
  return result.stdout.trim();
}

function countEntries(
  directory: string,
  deadline: StorageInventoryDeadline,
  label: string,
): number {
  requireRemainingDeadlineMs(deadline, `counting ${label}`);
  const count = fs.existsSync(directory) ? fs.readdirSync(directory).length : 0;
  requireRemainingDeadlineMs(deadline, `finishing ${label} count`);
  return count;
}

function countDirectories(
  directory: string,
  deadline: StorageInventoryDeadline,
  label: string,
): number {
  requireRemainingDeadlineMs(deadline, `counting ${label}`);
  const count = fs.existsSync(directory)
    ? fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory())
        .length
    : 0;
  requireRemainingDeadlineMs(deadline, `finishing ${label} count`);
  return count;
}

function countObjects(repository: string, deadline: StorageInventoryDeadline): CountObjectMetrics {
  const values = new Map<string, string>();
  for (const line of gitOutput(repository, ["count-objects", "-v"], deadline).split("\n")) {
    const separator = line.indexOf(":");
    if (separator < 1) {
      continue;
    }
    const key = line.slice(0, separator);
    if (values.has(key)) {
      throw new Error(`git count-objects returned duplicate metric: ${key}`);
    }
    values.set(key, line.slice(separator + 1).trim());
  }
  return Object.fromEntries(
    REQUIRED_COUNT_OBJECT_METRICS.map((key) => {
      const raw = values.get(key);
      if (raw === undefined) {
        throw new Error(`git count-objects is missing required metric: ${key}`);
      }
      if (!/^\d+$/u.test(raw)) {
        throw new Error(`git count-objects returned invalid numeric metric ${key}: ${raw}`);
      }
      const value = Number(raw);
      if (!Number.isSafeInteger(value)) {
        throw new Error(`git count-objects metric exceeds safe integer range: ${key}`);
      }
      return [key, value];
    }),
  ) as CountObjectMetrics;
}

function hashInventory(value: Omit<CustomRuntimeStorageInventory, "inventoryHash">): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function buildCustomRuntimeStorageInventory(
  options: BuildStorageInventoryOptions,
): CustomRuntimeStorageInventory {
  const deadline = createDeadline(options.deadlineMs);
  const evaluatedAt = options.evaluatedAt ?? new Date();
  if (Number.isNaN(evaluatedAt.valueOf())) {
    throw new Error("evaluatedAt must be a valid date");
  }
  const repository = fs.realpathSync(options.repository);
  gitOutput(repository, ["rev-parse", "--git-dir"], deadline);
  const runtimeHome = path.resolve(options.runtimeHome);
  const releasesDirectory = path.resolve(options.releasesDirectory);
  const updateWorktreesDirectory = path.resolve(options.updateWorktreesDirectory);
  const backups = path.join(runtimeHome, "backups");
  const receipts = path.join(runtimeHome, "receipts");
  const rollbacks = path.join(runtimeHome, "rollbacks");
  const objects = countObjects(repository, deadline);
  const base = {
    artifactCounts: {
      backups: countEntries(backups, deadline, "backups"),
      receipts: countEntries(receipts, deadline, "receipts"),
      releases: countDirectories(releasesDirectory, deadline, "releases"),
      rollbackBundles: countDirectories(rollbacks, deadline, "rollback bundles"),
      updateWorktrees: countDirectories(updateWorktreesDirectory, deadline, "update worktrees"),
    },
    evaluatedAt: evaluatedAt.toISOString(),
    git: {
      garbageBytes: kibibytesToBytes(objects["size-garbage"], "Git garbage size"),
      garbageObjects: objects.garbage,
      looseObjectBytes: kibibytesToBytes(objects.size, "Git loose object size"),
      looseObjects: objects.count,
      measurementStatus: "measured" as const,
      packedObjectBytes: kibibytesToBytes(objects["size-pack"], "Git packed object size"),
      packedObjects: objects["in-pack"],
      refs: gitOutput(repository, ["for-each-ref", "--format=%(refname)"], deadline)
        .split("\n")
        .filter(Boolean).length,
      repository,
      worktrees: gitOutput(repository, ["worktree", "list", "--porcelain"], deadline)
        .split("\n")
        .filter((line) => line.startsWith("worktree ")).length,
    },
    mode: "read_only" as const,
    schema: "openclaw.custom-runtime-storage-inventory.v1" as const,
    trees: {
      backups: scanTree(backups, deadline),
      receipts: scanTree(receipts, deadline),
      releases: scanTree(releasesDirectory, deadline),
      rollbacks: scanTree(rollbacks, deadline),
      updateWorktrees: scanTree(updateWorktreesDirectory, deadline),
    },
  };
  return { ...base, inventoryHash: hashInventory(base) };
}

function usage(message?: string): never {
  if (message) {
    process.stderr.write(`${message}\n`);
  }
  process.stderr.write(
    "usage: custom-runtime-storage-inventory.ts [--repo PATH] [--releases-dir PATH] " +
      "[--runtime-home PATH] [--update-worktrees-dir PATH] [--evaluated-at ISO]\n",
  );
  process.exit(64);
}

function main(): void {
  const options: BuildStorageInventoryOptions = {
    releasesDirectory:
      process.env.OPENCLAW_CUSTOM_RUNTIME_RELEASES ??
      path.join(os.homedir(), ".openclaw-runtime-releases"),
    repository: process.cwd(),
    runtimeHome:
      process.env.OPENCLAW_CUSTOM_RUNTIME_HOME ??
      path.join(os.homedir(), ".openclaw-custom-runtime"),
    updateWorktreesDirectory:
      process.env.OPENCLAW_CUSTOM_RUNTIME_UPDATE_WORKTREES ??
      path.join(os.homedir(), "OpenClaw-runtime-updates"),
  };
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    switch (value) {
      case "--repo":
        options.repository = argv[++index] ?? usage("missing --repo value");
        break;
      case "--releases-dir":
        options.releasesDirectory = argv[++index] ?? usage("missing --releases-dir value");
        break;
      case "--runtime-home":
        options.runtimeHome = argv[++index] ?? usage("missing --runtime-home value");
        break;
      case "--update-worktrees-dir":
        options.updateWorktreesDirectory =
          argv[++index] ?? usage("missing --update-worktrees-dir value");
        break;
      case "--evaluated-at": {
        const raw = argv[++index] ?? usage("missing --evaluated-at value");
        options.evaluatedAt = new Date(raw);
        break;
      }
      default:
        usage(`unsupported argument: ${value}`);
    }
  }
  process.stdout.write(`${JSON.stringify(buildCustomRuntimeStorageInventory(options), null, 2)}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main();
}

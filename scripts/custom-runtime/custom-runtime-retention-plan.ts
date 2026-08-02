import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DAY_MS = 24 * 60 * 60 * 1_000;
const RELEASE_ID_TIMESTAMP = /^(\d{8}T\d{6}Z)-/;
const RELEASE_ID = /^[A-Za-z0-9._-]+$/;
const SOURCE_SHA = /^[0-9a-f]{40}$/;

type RetentionAction = "eligible_for_quarantine" | "retain";

export type CustomRuntimeRetentionEntry = {
  action: RetentionAction;
  classification: "canonical" | "unclassified";
  createdAt?: string;
  reasons: string[];
  releaseId: string;
  sourceSha?: string;
};

export type CustomRuntimeRetentionPlan = {
  destructiveOperationsPermitted: false;
  evaluatedAt: string;
  keepNewest: number;
  minimumAgeDays: number;
  mode: "dry_run";
  planHash: string;
  releases: CustomRuntimeRetentionEntry[];
  releasesDirectory: string;
  schema: "openclaw.custom-runtime-retention-plan.v1";
  summary: {
    canonical: number;
    eligibleForQuarantine: number;
    retained: number;
    total: number;
    unclassified: number;
  };
};

type BuildRetentionPlanOptions = {
  keepNewest?: number;
  minimumAgeDays?: number;
  now?: Date;
  releasesDirectory: string;
  runtimeHome: string;
};

function readJsonObject(filePath: string): Record<string, unknown> | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("expected a JSON object");
    }
    return value as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `invalid retention protection state ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
}

function releaseIdFromPath(value: unknown, releasesDirectory: string): string | undefined {
  if (typeof value !== "string" || value.length === 0 || !path.isAbsolute(value)) {
    return undefined;
  }
  const resolved = path.resolve(value);
  if (path.dirname(resolved) !== releasesDirectory) {
    return undefined;
  }
  const releaseId = path.basename(resolved);
  return RELEASE_ID.test(releaseId) ? releaseId : undefined;
}

function requiredPointerReleaseId(
  pointer: Record<string, unknown> | undefined,
  releasesDirectory: string,
  stateName: string,
): string {
  if (!pointer) {
    throw new Error(`${stateName} protection state is missing`);
  }
  const releaseId = requiredReleaseId(pointer.releaseId, stateName);
  const runtimeReleaseId = releaseIdFromPath(pointer.runtimeRoot, releasesDirectory);
  if (!runtimeReleaseId) {
    throw new Error(`${stateName} runtimeRoot does not identify an immutable release`);
  }
  if (runtimeReleaseId !== releaseId) {
    throw new Error(`${stateName} releaseId does not match runtimeRoot: ${releaseId}`);
  }
  return releaseId;
}

function requiredReleaseId(value: unknown, stateName: string): string {
  if (typeof value !== "string" || !RELEASE_ID.test(value)) {
    throw new Error(`${stateName} release identity is invalid`);
  }
  return value;
}

function requiredNonEmptyString(value: unknown, stateName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${stateName} identity is invalid`);
  }
  return value;
}

function parseReleaseCreatedAt(releaseId: string): Date | undefined {
  const match = RELEASE_ID_TIMESTAMP.exec(releaseId);
  if (!match) {
    return undefined;
  }
  const value = match[1];
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(
    9,
    11,
  )}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.valueOf()) ? undefined : date;
}

function addProtectedReason(
  protectedReasons: Map<string, Set<string>>,
  releaseId: string | undefined,
  reason: string,
): void {
  if (!releaseId) {
    return;
  }
  const reasons = protectedReasons.get(releaseId) ?? new Set<string>();
  reasons.add(reason);
  protectedReasons.set(releaseId, reasons);
}

function collectProtectedReasons(
  runtimeHome: string,
  releasesDirectory: string,
): Map<string, Set<string>> {
  const reasons = new Map<string, Set<string>>();
  const active = readJsonObject(path.join(runtimeHome, "active-runtime.json"));
  const activeReleaseId = requiredPointerReleaseId(active, releasesDirectory, "active runtime");
  addProtectedReason(reasons, activeReleaseId, "active_runtime");
  const lastKnownGood = readJsonObject(path.join(runtimeHome, "last-known-good.json"));
  if (lastKnownGood) {
    addProtectedReason(
      reasons,
      requiredPointerReleaseId(lastKnownGood, releasesDirectory, "last-known-good runtime"),
      "last_known_good",
    );
  }

  const rollback = readJsonObject(path.join(runtimeHome, "active-rollback.json"));
  if (rollback) {
    const candidateReleaseId = requiredReleaseId(
      rollback.candidateReleaseId,
      "registered rollback candidate",
    );
    requiredNonEmptyString(
      rollback.candidateRuntimeReleaseId,
      "registered rollback candidate runtime",
    );
    const rollbackReleaseId = requiredReleaseId(
      rollback.rollbackReleaseId,
      "registered rollback target",
    );
    addProtectedReason(reasons, candidateReleaseId, "registered_rollback_candidate");
    addProtectedReason(reasons, rollbackReleaseId, "registered_rollback_target");
  }

  const pending = readJsonObject(path.join(runtimeHome, "pending-update.json"));
  if (pending) {
    const pendingRelease = releaseIdFromPath(pending.release, releasesDirectory);
    if (!pendingRelease || !RELEASE_ID.test(pendingRelease)) {
      throw new Error("pending update does not identify an immutable release");
    }
    addProtectedReason(reasons, pendingRelease, "pending_update");
  }
  return reasons;
}

function canonicalRelease(releasePath: string): { canonical: boolean; sourceSha?: string } {
  const stat = fs.lstatSync(releasePath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    return { canonical: false };
  }
  try {
    const sourceSha = fs
      .readFileSync(path.join(releasePath, ".openclaw-production-sha"), "utf8")
      .trim()
      .toLowerCase();
    if (!SOURCE_SHA.test(sourceSha)) {
      return { canonical: false };
    }
    if (!fs.statSync(path.join(releasePath, "dist", "index.js")).isFile()) {
      return { canonical: false };
    }
    return { canonical: true, sourceSha };
  } catch {
    return { canonical: false };
  }
}

function hashPlan(value: Omit<CustomRuntimeRetentionPlan, "planHash">): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function buildCustomRuntimeRetentionPlan(
  options: BuildRetentionPlanOptions,
): CustomRuntimeRetentionPlan {
  const keepNewest = options.keepNewest ?? 5;
  const minimumAgeDays = options.minimumAgeDays ?? 14;
  if (!Number.isSafeInteger(keepNewest) || keepNewest < 1) {
    throw new Error("keepNewest must be a positive integer");
  }
  if (!Number.isSafeInteger(minimumAgeDays) || minimumAgeDays < 1) {
    throw new Error("minimumAgeDays must be a positive integer");
  }

  const releasesDirectory = fs.realpathSync(options.releasesDirectory);
  const runtimeHome = fs.realpathSync(options.runtimeHome);
  const now = options.now ?? new Date();
  if (Number.isNaN(now.valueOf())) {
    throw new Error("now must be a valid date");
  }

  const protectedReasons = collectProtectedReasons(runtimeHome, releasesDirectory);
  const releases = fs
    .readdirSync(releasesDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => {
      const releaseId = entry.name;
      const releasePath = path.join(releasesDirectory, releaseId);
      const identity = canonicalRelease(releasePath);
      const createdAt = parseReleaseCreatedAt(releaseId);
      return { createdAt, identity, releaseId };
    })
    .toSorted((left, right) => {
      const timeDifference = (right.createdAt?.valueOf() ?? 0) - (left.createdAt?.valueOf() ?? 0);
      return timeDifference || right.releaseId.localeCompare(left.releaseId);
    });
  const releaseIds = new Set(releases.map((release) => release.releaseId));
  for (const protectedRelease of protectedReasons.keys()) {
    if (!releaseIds.has(protectedRelease)) {
      throw new Error(`protected release is missing: ${protectedRelease}`);
    }
  }

  for (const release of releases.filter((entry) => entry.identity.canonical).slice(0, keepNewest)) {
    addProtectedReason(protectedReasons, release.releaseId, "newest_canonical_release");
  }

  const cutoff = now.valueOf() - minimumAgeDays * DAY_MS;
  const entries = releases
    .map<CustomRuntimeRetentionEntry>((release) => {
      const reasons = protectedReasons.get(release.releaseId) ?? new Set<string>();
      if (!release.identity.canonical) {
        reasons.add("unclassified_release");
      }
      if (!release.createdAt) {
        reasons.add("unparseable_release_age");
      } else if (release.createdAt.valueOf() >= cutoff) {
        reasons.add("within_minimum_age");
      }
      const action: RetentionAction = reasons.size > 0 ? "retain" : "eligible_for_quarantine";
      const entry: CustomRuntimeRetentionEntry = {
        action,
        classification: release.identity.canonical ? "canonical" : "unclassified",
        reasons: [...reasons].toSorted(),
        releaseId: release.releaseId,
      };
      if (release.createdAt) {
        entry.createdAt = release.createdAt.toISOString();
      }
      if (release.identity.sourceSha) {
        entry.sourceSha = release.identity.sourceSha;
      }
      return entry;
    })
    .toSorted((left, right) => left.releaseId.localeCompare(right.releaseId));

  const base = {
    destructiveOperationsPermitted: false as const,
    evaluatedAt: now.toISOString(),
    keepNewest,
    minimumAgeDays,
    mode: "dry_run" as const,
    releases: entries,
    releasesDirectory,
    schema: "openclaw.custom-runtime-retention-plan.v1" as const,
    summary: {
      canonical: entries.filter((entry) => entry.classification === "canonical").length,
      eligibleForQuarantine: entries.filter((entry) => entry.action === "eligible_for_quarantine")
        .length,
      retained: entries.filter((entry) => entry.action === "retain").length,
      total: entries.length,
      unclassified: entries.filter((entry) => entry.classification === "unclassified").length,
    },
  };
  return { ...base, planHash: hashPlan(base) };
}

type CliOptions = {
  keepNewest?: number;
  minimumAgeDays?: number;
  now?: Date;
  releasesDirectory: string;
  runtimeHome: string;
};

function usage(message?: string): never {
  if (message) {
    process.stderr.write(`${message}\n`);
  }
  process.stderr.write(
    "usage: custom-runtime-retention-plan.ts [--releases-dir PATH] [--runtime-home PATH] " +
      "[--minimum-age-days N] [--keep-newest N] [--now ISO]\n",
  );
  process.exit(64);
}

function integerArgument(value: string | undefined, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    usage(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseCli(argv: string[]): CliOptions {
  const options: CliOptions = {
    releasesDirectory:
      process.env.OPENCLAW_CUSTOM_RUNTIME_RELEASES ??
      path.join(os.homedir(), ".openclaw-runtime-releases"),
    runtimeHome:
      process.env.OPENCLAW_CUSTOM_RUNTIME_HOME ??
      path.join(os.homedir(), ".openclaw-custom-runtime"),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    switch (value) {
      case "--releases-dir":
        options.releasesDirectory = argv[++index] ?? usage("missing --releases-dir value");
        break;
      case "--runtime-home":
        options.runtimeHome = argv[++index] ?? usage("missing --runtime-home value");
        break;
      case "--minimum-age-days":
        options.minimumAgeDays = integerArgument(argv[++index], "--minimum-age-days");
        break;
      case "--keep-newest":
        options.keepNewest = integerArgument(argv[++index], "--keep-newest");
        break;
      case "--now": {
        const raw = argv[++index] ?? usage("missing --now value");
        options.now = new Date(raw);
        if (Number.isNaN(options.now.valueOf())) {
          usage("--now must be an ISO timestamp");
        }
        break;
      }
      default:
        usage(`unsupported argument: ${value}`);
    }
  }
  return options;
}

function main(): void {
  try {
    const plan = buildCustomRuntimeRetentionPlan(parseCli(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main();
}

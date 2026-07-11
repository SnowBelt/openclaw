import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type PccRuntimeIdentitySource =
  | "release_pointer"
  | "environment"
  | "runtime_root"
  | "unavailable";

export type PccRuntimeIdentity = {
  runtimeSha: string | null;
  runtimeEntrypoint: string | null;
  expectedRuntimeRoot: string | null;
  expectedRuntimeEntrypoint: string | null;
  manifestPath: string | null;
  manifestSha256: string | null;
  buildId: string | null;
  identitySource: PccRuntimeIdentitySource;
  verified: boolean;
  driftReason: string | null;
};

export type PccRuntimeIdentityOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  homedir?: string;
  argv?: readonly string[];
  pointerPath?: string;
};

type ReleasePointer = {
  runtimeRoot: string;
  entrypoint: string;
  sourceSha: string;
  manifestPath: string;
  manifestSha256?: string;
};

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function shaText(value: unknown): string | null {
  const text = nonEmpty(value);
  return text && /^[a-f0-9]{7,256}$/iu.test(text) ? text : null;
}

function readText(filePath: string): string | null {
  try {
    return nonEmpty(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readJson(filePath: string): Record<string, unknown> | null {
  const text = readText(filePath);
  if (!text) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function pathIsSameOrChild(candidate: string, parent: string): boolean {
  const normalizedCandidate = path.resolve(candidate);
  const normalizedParent = path.resolve(parent);
  return (
    normalizedCandidate === normalizedParent ||
    normalizedCandidate.startsWith(`${normalizedParent}${path.sep}`)
  );
}

function sha256File(filePath: string): string | null {
  try {
    return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  } catch {
    return null;
  }
}

function unavailableIdentity(
  source: PccRuntimeIdentitySource,
  reason: string,
  expectedRuntimeRoot: string | null = null,
): PccRuntimeIdentity {
  return {
    runtimeSha: null,
    runtimeEntrypoint: null,
    expectedRuntimeRoot,
    expectedRuntimeEntrypoint: expectedRuntimeRoot
      ? path.join(expectedRuntimeRoot, "dist", "index.js")
      : null,
    manifestPath: expectedRuntimeRoot
      ? path.join(expectedRuntimeRoot, "dist", "control-ui", "dashboard-surfaces.json")
      : null,
    manifestSha256: null,
    buildId: null,
    identitySource: source,
    verified: false,
    driftReason: reason,
  };
}

function runtimeIdentityFromRoot(
  runtimeRoot: string,
  source: PccRuntimeIdentitySource,
  options: Required<Pick<PccRuntimeIdentityOptions, "env" | "argv">>,
): PccRuntimeIdentity {
  const root = path.resolve(runtimeRoot);
  const markerPath =
    options.env.OPENCLAW_PRODUCTION_SHA_FILE || path.join(root, ".openclaw-production-sha");
  const runtimeSha = shaText(readText(markerPath));
  const expectedRuntimeEntrypoint = path.join(root, "dist", "index.js");
  const manifestPath = path.join(root, "dist", "control-ui", "dashboard-surfaces.json");
  const manifest = readJson(manifestPath);
  const buildId = nonEmpty(manifest?.buildId);
  const actualEntrypoint = nonEmpty(options.argv[1]);
  const runtimeEntrypoint = actualEntrypoint
    ? path.resolve(actualEntrypoint)
    : expectedRuntimeEntrypoint;
  const entrypointDrift =
    actualEntrypoint && !pathIsSameOrChild(runtimeEntrypoint, root)
      ? `Gateway entrypoint is outside the configured runtime root: ${runtimeEntrypoint}`
      : null;
  const reason = !runtimeSha
    ? `Runtime SHA marker is missing or invalid: ${markerPath}`
    : !manifest
      ? `Runtime surface manifest is missing or invalid: ${manifestPath}`
      : entrypointDrift;
  return {
    runtimeSha,
    runtimeEntrypoint,
    expectedRuntimeRoot: root,
    expectedRuntimeEntrypoint,
    manifestPath,
    manifestSha256: sha256File(manifestPath),
    buildId,
    identitySource: source,
    verified: !reason,
    driftReason: reason,
  };
}

function parseReleasePointer(value: Record<string, unknown>): ReleasePointer | null {
  const runtimeRoot = nonEmpty(value.runtimeRoot);
  const entrypoint = nonEmpty(value.entrypoint);
  const sourceSha = shaText(value.sourceSha);
  const manifestPath = nonEmpty(value.manifestPath);
  const manifestSha256 = shaText(value.manifestSha256);
  if (!runtimeRoot || !entrypoint || !sourceSha || !manifestPath) {
    return null;
  }
  return {
    runtimeRoot,
    entrypoint,
    sourceSha,
    manifestPath,
    ...(manifestSha256 ? { manifestSha256 } : {}),
  };
}

function runtimeIdentityFromReleasePointer(
  pointerPath: string,
  options: Required<Pick<PccRuntimeIdentityOptions, "argv">>,
): PccRuntimeIdentity {
  const pointer = readJson(pointerPath);
  const parsed = pointer ? parseReleasePointer(pointer) : null;
  if (!parsed) {
    return unavailableIdentity(
      "release_pointer",
      `Runtime release pointer is invalid: ${pointerPath}`,
    );
  }
  const root = path.resolve(parsed.runtimeRoot);
  const expectedRuntimeEntrypoint = path.join(root, "dist", "index.js");
  const expectedManifestPath = path.join(root, "dist", "control-ui", "dashboard-surfaces.json");
  const markerSha = shaText(readText(path.join(root, ".openclaw-production-sha")));
  const manifest = readJson(parsed.manifestPath);
  const actualManifestSha = sha256File(parsed.manifestPath);
  const actualEntrypoint = nonEmpty(options.argv[1]);
  const runtimeEntrypoint = actualEntrypoint
    ? path.resolve(actualEntrypoint)
    : expectedRuntimeEntrypoint;
  const reasons = [
    path.resolve(parsed.entrypoint) !== expectedRuntimeEntrypoint
      ? "Runtime release pointer entrypoint is outside its release root"
      : null,
    path.resolve(parsed.manifestPath) !== expectedManifestPath
      ? "Runtime release pointer manifest is outside its release root"
      : null,
    markerSha !== parsed.sourceSha
      ? "Runtime release source marker does not match release pointer"
      : null,
    !manifest ? "Runtime release surface manifest is missing or invalid" : null,
    parsed.manifestSha256 && actualManifestSha !== parsed.manifestSha256
      ? "Runtime release surface manifest hash does not match release pointer"
      : null,
    actualEntrypoint && !pathIsSameOrChild(runtimeEntrypoint, root)
      ? `Gateway entrypoint is outside the active immutable release: ${runtimeEntrypoint}`
      : null,
  ].filter((reason): reason is string => Boolean(reason));
  return {
    runtimeSha: parsed.sourceSha,
    runtimeEntrypoint,
    expectedRuntimeRoot: root,
    expectedRuntimeEntrypoint,
    manifestPath: expectedManifestPath,
    manifestSha256: actualManifestSha,
    buildId: nonEmpty(manifest?.buildId),
    identitySource: "release_pointer",
    verified: reasons.length === 0,
    driftReason: reasons.length ? reasons.join("; ") : null,
  };
}

export function resolvePccRuntimeIdentity(
  options: PccRuntimeIdentityOptions = {},
): PccRuntimeIdentity {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const homedir = options.homedir ?? os.homedir();
  const argv = options.argv ?? process.argv;
  const configuredRoot =
    nonEmpty(env.OPENCLAW_PRODUCTION_RUNTIME_ROOT) || nonEmpty(env.OPENCLAW_RUNTIME_ROOT);
  if (configuredRoot) {
    return runtimeIdentityFromRoot(configuredRoot, "environment", { env, argv });
  }
  const pointerPath =
    options.pointerPath ??
    nonEmpty(env.OPENCLAW_CUSTOM_RUNTIME_POINTER) ??
    path.join(homedir, ".openclaw-custom-runtime", "active-runtime.json");
  if (fs.existsSync(pointerPath)) {
    return runtimeIdentityFromReleasePointer(pointerPath, { argv });
  }
  const rootIdentity = runtimeIdentityFromRoot(cwd, "runtime_root", { env, argv });
  return rootIdentity.runtimeSha
    ? rootIdentity
    : unavailableIdentity(
        "unavailable",
        rootIdentity.driftReason ?? "Runtime identity is unavailable.",
      );
}

export function readPccRuntimeIdentity(): PccRuntimeIdentity {
  return resolvePccRuntimeIdentity();
}

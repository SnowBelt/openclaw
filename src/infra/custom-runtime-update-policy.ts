// Detect an active immutable custom runtime so generic self-update paths fail closed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const CUSTOM_RUNTIME_UPDATE_BROKER_REQUIRED_REASON = "custom-runtime-update-broker-required";

export type CustomRuntimeUpdatePolicy = {
  managedRuntime: boolean;
  standardUpdateBlocked: boolean;
  sourceDurable: boolean;
  sourceSha: string | null;
  sourceRepo: string | null;
  sourceBranch: string | null;
  runtimeRoot: string | null;
  pointerPath: string;
  reason: string;
};

export type CustomRuntimeUpdatePolicyOptions = {
  env?: NodeJS.ProcessEnv;
  homedir?: string;
  argv?: readonly string[];
  pointerPath?: string;
};

type RuntimePointer = {
  runtimeRoot: string;
  entrypoint: string;
  sourceSha: string;
  sourceRepo: string | null;
  sourceBranch: string | null;
};

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readRuntimePointer(pointerPath: string): RuntimePointer | null {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(pointerPath, "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return null;
    }
    const record = raw as Record<string, unknown>;
    const runtimeRoot = nonEmptyString(record.runtimeRoot);
    const entrypoint = nonEmptyString(record.entrypoint);
    const sourceSha = nonEmptyString(record.sourceSha);
    if (!runtimeRoot || !entrypoint || !sourceSha) {
      return null;
    }
    const resolvedRoot = path.resolve(runtimeRoot);
    if (path.resolve(entrypoint) !== path.join(resolvedRoot, "dist", "index.js")) {
      return null;
    }
    return {
      runtimeRoot: resolvedRoot,
      entrypoint: path.resolve(entrypoint),
      sourceSha,
      sourceRepo: nonEmptyString(record.sourceRepo),
      sourceBranch: nonEmptyString(record.sourceBranch),
    };
  } catch {
    return null;
  }
}

function isSameOrChild(candidate: string, parent: string): boolean {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedParent = path.resolve(parent);
  return (
    resolvedCandidate === resolvedParent ||
    resolvedCandidate.startsWith(`${resolvedParent}${path.sep}`)
  );
}

export function resolveCustomRuntimeUpdatePolicy(
  options: CustomRuntimeUpdatePolicyOptions = {},
): CustomRuntimeUpdatePolicy {
  const env = options.env ?? process.env;
  const homedir = options.homedir ?? os.homedir();
  const argv = options.argv ?? process.argv;
  const pointerPath =
    options.pointerPath ??
    nonEmptyString(env.OPENCLAW_CUSTOM_RUNTIME_POINTER) ??
    path.join(homedir, ".openclaw-custom-runtime", "active-runtime.json");
  const pointer = readRuntimePointer(pointerPath);
  if (!pointer) {
    return {
      managedRuntime: false,
      standardUpdateBlocked: false,
      sourceDurable: false,
      sourceSha: null,
      sourceRepo: null,
      sourceBranch: null,
      runtimeRoot: null,
      pointerPath,
      reason: "No valid immutable custom-runtime pointer is active.",
    };
  }

  const snapshotRoot = nonEmptyString(env.OPENCLAW_RUNTIME_SNAPSHOT_ROOT);
  const wrapper = nonEmptyString(env.OPENCLAW_WRAPPER);
  const entrypoint = nonEmptyString(argv[1]);
  const managedRuntime =
    (snapshotRoot !== null && path.resolve(snapshotRoot) === pointer.runtimeRoot) ||
    (entrypoint !== null && isSameOrChild(entrypoint, pointer.runtimeRoot)) ||
    (wrapper !== null && path.basename(wrapper) === "custom-runtime-launcher.sh");
  const sourceDurable =
    /^[0-9a-f]{40}$/iu.test(pointer.sourceSha) &&
    pointer.sourceRepo !== null &&
    pointer.sourceBranch !== null;
  return {
    managedRuntime,
    standardUpdateBlocked: managedRuntime,
    sourceDurable,
    sourceSha: pointer.sourceSha,
    sourceRepo: pointer.sourceRepo,
    sourceBranch: pointer.sourceBranch,
    runtimeRoot: pointer.runtimeRoot,
    pointerPath,
    reason: managedRuntime
      ? "This Gateway uses an immutable custom runtime; updates must pass through the custom-runtime broker."
      : "A custom-runtime pointer exists, but this process is not running from it.",
  };
}

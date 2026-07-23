#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseCustomRuntimeCapabilityManifest } from "../src/pcc/custom-runtime-capabilities.js";

export const CONTROL_DIRECTOR_DEPLOYMENT_CAPABILITY_ID =
  "runtime:control-director-deployment-consistency";

export const CONTROL_DIRECTOR_DEPLOYMENT_PATHS = Object.freeze({
  skill: [".agents/skills/control-director-reliability/SKILL.md"],
  plugins: ["extensions/apps/openclaw.plugin.json", "extensions/book-writer/openclaw.plugin.json"],
  prompts: [
    "src/agents/agent-role-capabilities.ts",
    "src/agents/control-director-turn-policy.ts",
    "scripts/custom-runtime/control-director-role-config.py",
  ],
  workflow: [".github/workflows/workflow-sanity.yml"],
  runtimeHelpers: [
    "scripts/control-director-deployment-consistency.ts",
    "scripts/custom-runtime/custom-runtime-activate.sh",
    "scripts/custom-runtime/custom-runtime-guard.sh",
    "scripts/custom-runtime/custom-runtime-restart.sh",
    "scripts/custom-runtime/custom-runtime-rollback.sh",
    "scripts/custom-runtime/custom-runtime-updater.sh",
  ],
  inventory: ["config/custom-runtime-capabilities.json", "src/pcc/capability-addition-registry.ts"],
});

export const CONTROL_DIRECTOR_DEPLOYMENT_REQUIRED_PATHS = Object.freeze(
  Object.values(CONTROL_DIRECTOR_DEPLOYMENT_PATHS).flat(),
);

const REQUIRED_SERVICES = Object.freeze([
  "ai.openclaw.gateway",
  "ai.openclaw.custom-runtime.update-weekly",
  "ai.openclaw.custom-runtime.guard",
]);
const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const defaultRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type JsonObject = Record<string, unknown>;

type DeploymentReceipt = {
  schema: "openclaw.control-director-deployment-consistency.v1";
  sourceSha: string;
  mode: "source" | "live";
  passed: true;
  categories: Record<string, { passed: true; fileCount: number }>;
  capability: { id: string; registered: true; pathCount: number };
  fileDigests: Record<string, string>;
  runtime?: {
    immutable: true;
    exactSha: true;
    manifestBound: true;
    restartReceiptBound: true;
    launcherVerified: true;
    bundledPluginsVerified: true;
    releaseId: string;
    services: Record<string, true>;
  };
};

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readObject(filePath: string, label: string): JsonObject {
  const value = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  if (!isRecord(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is missing.`);
  }
  return value.trim();
}

function sha256(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function requireRegularFile(root: string, relativePath: string): string {
  const absolutePath = path.resolve(root, relativePath);
  const relative = path.relative(path.resolve(root), absolutePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Deployment path is unsafe: ${relativePath}.`);
  }
  const stat = fs.statSync(absolutePath, { throwIfNoEntry: false });
  if (!stat?.isFile()) {
    throw new Error(`Required deployment file is missing: ${relativePath}.`);
  }
  return absolutePath;
}

function isSameOrChild(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function parseReceiptTime(value: unknown, label: string): number {
  const compact = requireString(value, label);
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/u.exec(compact);
  const normalized = match
    ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`
    : compact;
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`${label} is invalid.`);
  }
  return timestamp;
}

function requireCapability(root: string) {
  const manifestPath = requireRegularFile(root, "config/custom-runtime-capabilities.json");
  const manifest = parseCustomRuntimeCapabilityManifest(
    JSON.parse(fs.readFileSync(manifestPath, "utf8")) as unknown,
  );
  if (!manifest) {
    throw new Error("Custom runtime capability manifest is invalid.");
  }
  const matches = manifest.capabilities.filter(
    (entry) => entry.id === CONTROL_DIRECTOR_DEPLOYMENT_CAPABILITY_ID,
  );
  if (matches.length !== 1) {
    throw new Error("Control Director deployment capability must be registered exactly once.");
  }
  const actual = [...matches[0]!.requiredPaths].toSorted();
  const expected = [...CONTROL_DIRECTOR_DEPLOYMENT_REQUIRED_PATHS].toSorted();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Control Director deployment capability path inventory is incomplete.");
  }
  return { manifestPath, manifest, capability: matches[0]! };
}

function sourceFacts(sourceRoot: string) {
  const { manifestPath } = requireCapability(sourceRoot);
  const fileDigests: Record<string, string> = {};
  const categories: Record<string, { passed: true; fileCount: number }> = {};
  for (const [category, paths] of Object.entries(CONTROL_DIRECTOR_DEPLOYMENT_PATHS)) {
    for (const relativePath of paths) {
      fileDigests[relativePath] = sha256(requireRegularFile(sourceRoot, relativePath));
    }
    categories[category] = { passed: true, fileCount: paths.length };
  }
  if (fileDigests["config/custom-runtime-capabilities.json"] !== sha256(manifestPath)) {
    throw new Error("Capability manifest digest is inconsistent.");
  }
  return { categories, fileDigests };
}

function defaultServiceProbe(label: string): boolean {
  return (
    spawnSync("launchctl", ["print", `gui/${process.getuid?.() ?? 0}/${label}`], {
      stdio: "ignore",
    }).status === 0
  );
}

function defaultLauncherVerify(launcherPath: string): boolean {
  return spawnSync(launcherPath, ["--verify"], { stdio: "ignore" }).status === 0;
}

export function verifyControlDirectorDeploymentConsistency(options: {
  sourceRoot: string;
  expectedSha: string;
  pointerPath?: string;
  releasesRoot?: string;
  restartReceiptPath?: string;
  launcherPath?: string;
  serviceProbe?: (label: string) => boolean;
  launcherVerify?: (launcherPath: string) => boolean;
}): DeploymentReceipt {
  const expectedSha = options.expectedSha.trim().toLowerCase();
  if (!SHA_PATTERN.test(expectedSha)) {
    throw new Error("Expected source SHA must be an immutable 40-character SHA.");
  }
  const sourceRoot = fs.realpathSync(options.sourceRoot);
  const source = sourceFacts(sourceRoot);
  const base: DeploymentReceipt = {
    schema: "openclaw.control-director-deployment-consistency.v1",
    sourceSha: expectedSha,
    mode: options.pointerPath ? "live" : "source",
    passed: true,
    categories: source.categories,
    capability: {
      id: CONTROL_DIRECTOR_DEPLOYMENT_CAPABILITY_ID,
      registered: true,
      pathCount: CONTROL_DIRECTOR_DEPLOYMENT_REQUIRED_PATHS.length,
    },
    fileDigests: source.fileDigests,
  };
  if (!options.pointerPath) {
    return base;
  }

  const releasesRoot = fs.realpathSync(
    options.releasesRoot ?? path.join(os.homedir(), ".openclaw-runtime-releases"),
  );
  const pointer = readObject(options.pointerPath, "Active runtime pointer");
  const runtimeRoot = fs.realpathSync(requireString(pointer.runtimeRoot, "Runtime root"));
  if (!isSameOrChild(releasesRoot, runtimeRoot) || runtimeRoot === releasesRoot) {
    throw new Error("Active runtime is outside the immutable release root.");
  }
  if (requireString(pointer.sourceSha, "Runtime source SHA").toLowerCase() !== expectedSha) {
    throw new Error("Active runtime source SHA does not match the expected SHA.");
  }
  const requiredCapabilities = pointer.requiredCapabilities;
  if (
    !Array.isArray(requiredCapabilities) ||
    !requiredCapabilities.includes(CONTROL_DIRECTOR_DEPLOYMENT_CAPABILITY_ID)
  ) {
    throw new Error("Active runtime pointer does not require the deployment capability.");
  }

  const runtimeCapability = requireCapability(runtimeRoot);
  const pointerManifestPath = fs.realpathSync(
    requireString(pointer.capabilityManifestPath, "Capability manifest path"),
  );
  if (pointerManifestPath !== fs.realpathSync(runtimeCapability.manifestPath)) {
    throw new Error("Active runtime capability manifest path is not release-bound.");
  }
  const pointerManifestHash = requireString(
    pointer.capabilityManifestSha256,
    "Capability manifest digest",
  ).toLowerCase();
  if (
    !HASH_PATTERN.test(pointerManifestHash) ||
    sha256(pointerManifestPath) !== pointerManifestHash
  ) {
    throw new Error("Active runtime capability manifest digest mismatch.");
  }

  for (const [relativePath, expectedDigest] of Object.entries(source.fileDigests)) {
    const runtimeDigest = sha256(requireRegularFile(runtimeRoot, relativePath));
    if (runtimeDigest !== expectedDigest) {
      throw new Error(`Immutable runtime file differs from source: ${relativePath}.`);
    }
  }
  for (const pluginId of ["apps", "book-writer"]) {
    requireRegularFile(runtimeRoot, `dist-runtime/extensions/${pluginId}/openclaw.plugin.json`);
  }
  const stamp = fs
    .readFileSync(requireRegularFile(runtimeRoot, ".openclaw-production-sha"), "utf8")
    .trim()
    .toLowerCase();
  if (stamp !== expectedSha) {
    throw new Error("Immutable runtime source stamp mismatch.");
  }
  const snapshot = readObject(requireRegularFile(runtimeRoot, "snapshot.json"), "Runtime snapshot");
  const releaseId = requireString(snapshot.releaseId, "Runtime release ID");
  if (requireString(pointer.releaseId, "Pointer release ID") !== releaseId) {
    throw new Error("Active runtime pointer release ID mismatch.");
  }
  const snapshotSource = snapshot.source;
  if (
    !isRecord(snapshotSource) ||
    requireString(snapshotSource.commit, "Snapshot source SHA") !== expectedSha
  ) {
    throw new Error("Runtime snapshot source SHA mismatch.");
  }
  if (!options.restartReceiptPath) {
    throw new Error("Live deployment verification requires a restart receipt.");
  }
  const runtimeHome = path.dirname(path.resolve(options.pointerPath));
  const restartReceiptPath = fs.realpathSync(options.restartReceiptPath);
  const receiptRoot = fs.realpathSync(path.join(runtimeHome, "receipts"));
  if (!isSameOrChild(receiptRoot, restartReceiptPath) || restartReceiptPath === receiptRoot) {
    throw new Error("Restart receipt is outside the managed receipt directory.");
  }
  const restart = readObject(restartReceiptPath, "Restart receipt");
  if (restart.result !== "restarted_verified" || restart.release !== releaseId) {
    throw new Error("Restart receipt is not bound to the active verified release.");
  }
  if (
    parseReceiptTime(restart.at, "Restart receipt time") <
    parseReceiptTime(pointer.promotedAt, "Runtime promotion time")
  ) {
    throw new Error("Restart receipt predates the active runtime promotion.");
  }
  const launcherPath =
    options.launcherPath ?? path.join(runtimeHome, "bin", "custom-runtime-launcher.sh");
  if (!(options.launcherVerify ?? defaultLauncherVerify)(launcherPath)) {
    throw new Error("Managed runtime launcher verification failed.");
  }
  const services: Record<string, true> = {};
  for (const label of REQUIRED_SERVICES) {
    if (!(options.serviceProbe ?? defaultServiceProbe)(label)) {
      throw new Error(`Required managed service is not loaded: ${label}.`);
    }
    services[label] = true;
  }
  base.runtime = {
    immutable: true,
    exactSha: true,
    manifestBound: true,
    restartReceiptBound: true,
    launcherVerified: true,
    bundledPluginsVerified: true,
    releaseId,
    services,
  };
  return base;
}

function parseArgs(argv: string[]) {
  const args: {
    expectedSha: string;
    sourceOnly: boolean;
    json: boolean;
    pointerPath?: string;
    releasesRoot?: string;
    restartReceiptPath?: string;
    artifactDir: string;
  } = {
    expectedSha: "",
    sourceOnly: false,
    json: false,
    artifactDir: path.join(defaultRepoRoot, ".artifacts", "control-director"),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--") {
      continue;
    }
    if (value === "--expected-sha") {
      args.expectedSha = argv[++index] ?? "";
    } else if (value === "--source-only") {
      args.sourceOnly = true;
    } else if (value === "--json") {
      args.json = true;
    } else if (value === "--pointer") {
      args.pointerPath = path.resolve(argv[++index] ?? "");
    } else if (value === "--releases-root") {
      args.releasesRoot = path.resolve(argv[++index] ?? "");
    } else if (value === "--restart-receipt") {
      args.restartReceiptPath = path.resolve(argv[++index] ?? "");
    } else if (value === "--artifact-dir") {
      args.artifactDir = path.resolve(argv[++index] ?? "");
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  return args;
}

function git(args: string[]): string {
  const result = spawnSync("git", args, { cwd: defaultRepoRoot, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error("Unable to verify source Git identity.");
  }
  return result.stdout.trim();
}

function writeReceipt(filePath: string, receipt: DeploymentReceipt) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const head = git(["rev-parse", "HEAD"]).toLowerCase();
  const expectedSha = (args.expectedSha || head).toLowerCase();
  if (head !== expectedSha || git(["status", "--porcelain=v1", "--untracked-files=all"])) {
    throw new Error("Deployment verification requires a clean exact-SHA source checkout.");
  }
  if (!args.sourceOnly && !args.pointerPath) {
    args.pointerPath = path.join(os.homedir(), ".openclaw-custom-runtime", "active-runtime.json");
  }
  const receipt = verifyControlDirectorDeploymentConsistency({
    sourceRoot: defaultRepoRoot,
    expectedSha,
    ...(args.sourceOnly ? {} : { pointerPath: args.pointerPath }),
    ...(args.releasesRoot ? { releasesRoot: args.releasesRoot } : {}),
    ...(args.restartReceiptPath ? { restartReceiptPath: args.restartReceiptPath } : {}),
  });
  const receiptPath = path.join(args.artifactDir, `deployment-consistency-${expectedSha}.json`);
  writeReceipt(receiptPath, receipt);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } else {
    process.stdout.write(`control-director-deployment-consistency: PASS ${expectedSha}\n`);
  }
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

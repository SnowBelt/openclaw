#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  CUSTOM_RUNTIME_CAPABILITY_SCHEMA,
  findUnregisteredCustomRuntimePaths,
  parseCustomRuntimeCapabilityManifest,
  validateCustomRuntimeCapabilityManifest,
  type CustomRuntimeCapability,
  type CustomRuntimeCapabilityManifest,
} from "../../src/pcc/custom-runtime-capabilities.js";
import { DASHBOARD_SURFACES } from "../../ui/config/dashboard-surfaces.js";

const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "../..");

export const UPDATE_SURVIVAL_VERIFICATION_COMMANDS = Object.freeze([
  "pnpm check:custom-runtime-capabilities",
  "pnpm check:pcc-capabilities",
  "pnpm control-director:verify -- --expected-sha <candidate-sha>",
  "pnpm check",
  "pnpm ui:build",
  "pnpm build",
  "pnpm ui:smoke:dashboard --artifact-profile release --artifact-root .artifacts/custom-runtime-update",
]);

const REQUIRED_UPDATE_SAFE_PATHS = Object.freeze([
  "config/custom-runtime-capabilities.json",
  "package.json",
  "src/infra/custom-runtime-update-policy.ts",
  "src/pcc/capability-addition-registry.ts",
  "src/pcc/custom-runtime-capabilities.test.ts",
  "src/pcc/custom-runtime-capabilities.ts",
  "src/pcc/update-safety.test.ts",
  "src/pcc/update-safety.ts",
  "scripts/check.mjs",
  "scripts/check-custom-runtime-capabilities.ts",
  "scripts/control-director-milestone-audit.mjs",
  "scripts/control-director-preflight.mjs",
  "scripts/control-director-readiness.mjs",
  "scripts/control-director-roadmap-proof.mjs",
  "scripts/control-director-source-handoff.mjs",
  "scripts/control-director-verify.mjs",
  "scripts/custom-runtime/ai.openclaw.custom-runtime.guard.plist",
  "scripts/custom-runtime/ai.openclaw.custom-runtime.update-weekly.plist",
  "scripts/custom-runtime/copy_stage_state.py",
  "scripts/custom-runtime/custom-runtime-activate.sh",
  "scripts/custom-runtime/custom-runtime-auth.sh",
  "scripts/custom-runtime/custom-runtime-guard.sh",
  "scripts/custom-runtime/custom-runtime-restart.sh",
  "scripts/custom-runtime/custom-runtime-rollback.sh",
  "scripts/custom-runtime/custom-runtime-update-survival.ts",
  "scripts/custom-runtime/custom-runtime-updater.sh",
  "scripts/custom-runtime/custom-runtime-update-approve.sh",
  "scripts/custom-runtime/custom-runtime-stage.sh",
  "scripts/custom-runtime/custom-runtime-promote.sh",
  "scripts/custom-runtime/custom-runtime-usability-coordinator.mjs",
  "scripts/custom-runtime/custom-runtime-launcher.sh",
  "test/scripts/control-director-readiness.test.ts",
  "test/scripts/control-director-milestone-audit.test.ts",
  "test/scripts/control-director-preflight.test.ts",
  "test/scripts/control-director-roadmap-proof.test.ts",
  "test/scripts/control-director-source-handoff.test.ts",
  "test/scripts/control-director-verify.test.ts",
  "test/scripts/custom-runtime-lifecycle.test.ts",
  "test/scripts/custom-runtime-lifecycle-arbitration.test.ts",
  "test/scripts/custom-runtime-stage-promote.test.ts",
  "test/scripts/custom-runtime-usability-coordinator.test.ts",
  "test/scripts/custom-runtime-update-survival.test.ts",
  "test/scripts/custom-runtime-updater.test.ts",
  "ui/src/ui/views/pcc.test.ts",
  "ui/src/ui/views/pcc.ts",
  ".agents/skills/control-director-reliability/SKILL.md",
  ".github/workflows/control-director-reliability.yml",
  ".github/workflows/workflow-sanity.yml",
  "work/control-director/reliability-v1/roadmap.json",
  "work/control-director/reliability-v1/continuation.md",
  "work/control-director/reliability-v1/source-handoff-policy.json",
  "docs/automation/custom-runtime-update-safety.md",
  "docs/automation/control-director-source-handoff.md",
  "docs/automation/pcc-operational-excellence.md",
  "docs/concepts/control-director.md",
]);

type JsonObject = Record<string, unknown>;

type CandidateProofParams = {
  repoRoot: string;
  activeSha: string;
  officialRef: string;
  candidateSha: string;
  activeManifest: CustomRuntimeCapabilityManifest;
  candidateManifest: CustomRuntimeCapabilityManifest;
  dashboardSurfaceIds?: readonly string[];
  checkedAt?: string;
};

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as JsonObject;
}

function readJson(filePath: string): JsonObject {
  return object(JSON.parse(fs.readFileSync(filePath, "utf8")), filePath);
}

function sha256(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function immutableSha(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA_PATTERN.test(normalized)) {
    throw new Error(`${label} must be an immutable 40-character SHA.`);
  }
  return normalized;
}

function git(repoRoot: string, args: string[], allowFailure = false) {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result;
}

function resolveGitSha(repoRoot: string, value: string, label: string): string {
  const result = git(repoRoot, ["rev-parse", "--verify", `${value}^{commit}`]);
  return immutableSha(result.stdout.trim(), label);
}

function hasSafeRelativePath(value: string): boolean {
  const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
  return (
    normalized === value &&
    !path.posix.isAbsolute(normalized) &&
    normalized !== ".." &&
    !normalized.startsWith("../")
  );
}

export function parsePreviousCapabilityManifest(value: unknown): CustomRuntimeCapabilityManifest {
  const current = parseCustomRuntimeCapabilityManifest(value);
  if (current) {
    return current;
  }
  const raw = object(value, "previous capability manifest");
  const schema = typeof raw.schema === "string" ? raw.schema : "";
  if (
    !["openclaw.custom-runtime-capabilities.v1", CUSTOM_RUNTIME_CAPABILITY_SCHEMA].includes(
      schema,
    ) ||
    !Number.isInteger(raw.version) ||
    !Array.isArray(raw.capabilities)
  ) {
    throw new Error("Previous capability manifest identity is invalid.");
  }
  const capabilities: CustomRuntimeCapability[] = raw.capabilities.map((entry, index) => {
    const item = object(entry, `previous capability ${index}`);
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const kind = typeof item.kind === "string" ? item.kind : "";
    const requiredPaths = Array.isArray(item.requiredPaths)
      ? item.requiredPaths.filter(
          (candidate): candidate is string =>
            typeof candidate === "string" && Boolean(candidate.trim()),
        )
      : [];
    if (
      !id ||
      !["dashboard_surface", "plugin", "workflow", "runtime"].includes(kind) ||
      requiredPaths.length === 0 ||
      requiredPaths.some((candidate) => !hasSafeRelativePath(candidate))
    ) {
      throw new Error(`Previous capability ${index} is invalid.`);
    }
    return {
      id,
      kind: kind as CustomRuntimeCapability["kind"],
      requiredPaths,
      ...(typeof item.surfaceId === "string" && item.surfaceId.trim()
        ? { surfaceId: item.surfaceId.trim() }
        : {}),
      ...(typeof item.pluginId === "string" && item.pluginId.trim()
        ? { pluginId: item.pluginId.trim() }
        : {}),
    };
  });
  return {
    schema: schema as CustomRuntimeCapabilityManifest["schema"],
    version: Number(raw.version),
    capabilities,
  };
}

export function validateCapabilityMonotonicity(
  active: CustomRuntimeCapabilityManifest,
  candidate: CustomRuntimeCapabilityManifest,
): string[] {
  const errors: string[] = [];
  if (candidate.version < active.version) {
    errors.push(
      `Candidate capability manifest version ${candidate.version} regressed below active version ${active.version}.`,
    );
  }
  const candidateById = new Map(
    candidate.capabilities.map((capability) => [capability.id, capability]),
  );
  for (const previous of active.capabilities) {
    const next = candidateById.get(previous.id);
    if (!next) {
      errors.push(`Candidate removed required custom capability ${previous.id}.`);
      continue;
    }
    if (
      next.kind !== previous.kind ||
      (previous.surfaceId && next.surfaceId !== previous.surfaceId) ||
      (previous.pluginId && next.pluginId !== previous.pluginId)
    ) {
      errors.push(`Candidate changed the identity of required custom capability ${previous.id}.`);
    }
    for (const requiredPath of previous.requiredPaths) {
      if (!next.requiredPaths.includes(requiredPath)) {
        errors.push(
          `Candidate removed ${requiredPath} from required custom capability ${previous.id}.`,
        );
      }
    }
  }
  return errors;
}

function auditCurrentManifest(
  manifest: CustomRuntimeCapabilityManifest | null,
  dashboardSurfaceIds: readonly string[],
): string[] {
  if (!manifest) {
    return ["Current custom runtime capability manifest is invalid."];
  }
  const errors = validateCustomRuntimeCapabilityManifest({ manifest, dashboardSurfaceIds });
  const preservation = manifest.preservation;
  if (manifest.schema !== CUSTOM_RUNTIME_CAPABILITY_SCHEMA || !preservation) {
    errors.push("Update survival requires the current v2 capability manifest.");
    return errors;
  }
  if (manifest.version < 5) {
    errors.push("Update survival requires custom capability inventory revision 5 or newer.");
  }
  if (preservation.contractVersion !== 2) {
    errors.push("Update survival requires preservation contract v2.");
  }
  if (preservation.sourceStrategy !== "merge_from_active_sha") {
    errors.push("Update survival must merge official updates from the exact active SHA.");
  }
  if (preservation.dashboardChangePolicy !== "register_verify_and_block") {
    errors.push("Dashboard changes must register, verify, and block on preservation failure.");
  }
  if (preservation.approvalPolicy !== "explicit_exact_candidate") {
    errors.push("Update survival requires explicit approval of one exact candidate.");
  }
  if (preservation.proofCommand !== "pnpm custom-runtime:update-survival") {
    errors.push("Update survival proof command is not canonical.");
  }
  if (
    JSON.stringify(preservation.verificationCommands) !==
    JSON.stringify(UPDATE_SURVIVAL_VERIFICATION_COMMANDS)
  ) {
    errors.push("Update survival verification commands do not match the canonical ordered gate.");
  }
  const updateSafe = manifest.capabilities.find(
    (capability) => capability.id === "runtime:update-safe-customizations",
  );
  if (!updateSafe) {
    errors.push("Update-safe customizations capability is missing.");
  } else {
    for (const requiredPath of REQUIRED_UPDATE_SAFE_PATHS) {
      if (!updateSafe.requiredPaths.includes(requiredPath)) {
        errors.push(`Update-safe customizations capability does not preserve ${requiredPath}.`);
      }
    }
  }
  return errors;
}

export function auditUpdateSurvivalRepository(repoRoot: string): string[] {
  const manifest = parseCustomRuntimeCapabilityManifest(
    readJson(path.join(repoRoot, "config", "custom-runtime-capabilities.json")),
  );
  const errors = auditCurrentManifest(
    manifest,
    DASHBOARD_SURFACES.map((surface) => surface.id),
  );
  if (manifest) {
    const trackedCustomRuntimePaths = git(repoRoot, ["ls-files", "--", "scripts/custom-runtime"])
      .stdout.split(/\r?\n/u)
      .filter(Boolean);
    for (const unregisteredPath of findUnregisteredCustomRuntimePaths(
      manifest,
      trackedCustomRuntimePaths,
    )) {
      errors.push(
        `Tracked custom-runtime control-plane file is not registered by any capability: ${unregisteredPath}.`,
      );
    }
  }
  const packageJson = readJson(path.join(repoRoot, "package.json"));
  const scripts = object(packageJson.scripts, "package scripts");
  if (
    scripts["custom-runtime:update-survival"] !==
    "node --import tsx scripts/custom-runtime/custom-runtime-update-survival.ts"
  ) {
    errors.push("Package scripts do not expose the canonical update-survival command.");
  }
  const updater = fs.readFileSync(
    path.join(repoRoot, "scripts", "custom-runtime", "custom-runtime-updater.sh"),
    "utf8",
  );
  const approval = fs.readFileSync(
    path.join(repoRoot, "scripts", "custom-runtime", "custom-runtime-update-approve.sh"),
    "utf8",
  );
  const promotion = fs.readFileSync(
    path.join(repoRoot, "scripts", "custom-runtime", "custom-runtime-promote.sh"),
    "utf8",
  );
  if (
    [
      "custom-runtime:update-survival",
      "preservationProof",
      "executedVerificationCommands",
      "active_sha:config/custom-runtime-capabilities.json",
      "verified_source_drift",
    ].some((fragment) => !updater.includes(fragment))
  ) {
    errors.push("Update broker does not create and bind update-survival proof.");
  }
  if (
    [
      "preservationProof",
      "executedVerificationCommands",
      "runtime:update-safe-customizations",
      "changed a preservation-bound path",
    ].some((fragment) => !approval.includes(fragment))
  ) {
    errors.push("Update approval does not verify the bound update-survival proof.");
  }
  if (
    [
      "ai.openclaw.custom-runtime.update-weekly.plist",
      "install_update_scheduler",
      "updateBrokerScheduled",
      "ai.openclaw.custom-runtime.guard.plist",
      "install_runtime_guard",
      "runtimeGuardScheduled",
    ].some((fragment) => !promotion.includes(fragment))
  ) {
    errors.push(
      "Managed promotion does not install the proof-gated update scheduler and recovery guard.",
    );
  }
  for (const script of [
    "custom-runtime-stage.sh",
    "custom-runtime-promote.sh",
    "custom-runtime-launcher.sh",
  ]) {
    const source = fs.readFileSync(
      path.join(repoRoot, "scripts", "custom-runtime", script),
      "utf8",
    );
    if (
      !source.includes('preservation.get("contractVersion") != 2') ||
      !source.includes('preservation.get("dashboardChangePolicy") != "register_verify_and_block"')
    ) {
      errors.push(`${script} does not enforce preservation contract v2.`);
    }
  }
  if (
    !fs
      .readFileSync(path.join(repoRoot, "scripts", "control-director-verify.mjs"), "utf8")
      .includes('id: "update-survival"')
  ) {
    errors.push("Control Director source verification omits update survival.");
  }
  if (
    !fs
      .readFileSync(path.join(repoRoot, "scripts", "control-director-readiness.mjs"), "utf8")
      .includes("updateSafeCustomizationLifecycle")
  ) {
    errors.push("Control Director readiness omits update-safe lifecycle wiring.");
  }
  if (
    !fs
      .readFileSync(path.join(repoRoot, ".github", "workflows", "workflow-sanity.yml"), "utf8")
      .includes("Run update-survival contract")
  ) {
    errors.push("Workflow Sanity omits the update-survival contract gate.");
  }
  const skill = fs.readFileSync(
    path.join(repoRoot, ".agents", "skills", "control-director-reliability", "SKILL.md"),
    "utf8",
  );
  if (!skill.includes("M61") || !skill.includes("pnpm custom-runtime:update-survival")) {
    errors.push("Control Director reliability skill omits the M61 update-survival procedure.");
  }
  const roadmap = readJson(
    path.join(repoRoot, "work", "control-director", "reliability-v1", "roadmap.json"),
  );
  const milestones = Array.isArray(roadmap.milestones) ? roadmap.milestones : [];
  if (!milestones.some((entry) => object(entry, "roadmap milestone").id === "M61")) {
    errors.push("Control Director reliability roadmap omits M61 update survival.");
  }
  return errors;
}

export function buildCandidateUpdateSurvivalProof(params: CandidateProofParams): JsonObject {
  const repoRoot = path.resolve(params.repoRoot);
  const activeSha = immutableSha(params.activeSha, "activeSha");
  const candidateSha = immutableSha(params.candidateSha, "candidateSha");
  const officialSha = resolveGitSha(repoRoot, params.officialRef, "officialSha");
  const headSha = resolveGitSha(repoRoot, "HEAD", "HEAD");
  if (headSha !== candidateSha) {
    throw new Error("Candidate SHA does not match the checked-out HEAD.");
  }
  if (git(repoRoot, ["status", "--porcelain"]).stdout.trim()) {
    throw new Error("Candidate source checkout is dirty.");
  }
  for (const ancestor of [activeSha, officialSha]) {
    if (git(repoRoot, ["merge-base", "--is-ancestor", ancestor, candidateSha], true).status !== 0) {
      throw new Error(`Candidate does not contain required ancestor ${ancestor}.`);
    }
  }
  const parentLine = git(repoRoot, ["rev-list", "--parents", "-n", "1", candidateSha])
    .stdout.trim()
    .split(/\s+/u);
  const parents = parentLine.slice(1);
  if (parents.length !== 2 || parents[0] !== activeSha || parents[1] !== officialSha) {
    throw new Error(
      "Candidate must be the exact two-parent merge of active SHA then official SHA.",
    );
  }
  const candidateErrors = auditCurrentManifest(
    params.candidateManifest,
    params.dashboardSurfaceIds ?? DASHBOARD_SURFACES.map((surface) => surface.id),
  );
  const monotonicErrors = validateCapabilityMonotonicity(
    params.activeManifest,
    params.candidateManifest,
  );
  const errors = [...candidateErrors, ...monotonicErrors];
  const requiredPathDigests = new Map<string, string>();
  for (const capability of params.candidateManifest.capabilities) {
    for (const requiredPath of capability.requiredPaths) {
      const absolutePath = path.resolve(repoRoot, requiredPath);
      const relative = path.relative(repoRoot, absolutePath);
      if (
        relative.startsWith("..") ||
        path.isAbsolute(relative) ||
        !fs.existsSync(absolutePath) ||
        !fs.statSync(absolutePath).isFile()
      ) {
        errors.push(`Candidate required path is unavailable: ${requiredPath}.`);
      } else if (!requiredPathDigests.has(requiredPath)) {
        requiredPathDigests.set(requiredPath, sha256(absolutePath));
      }
    }
  }
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
  return {
    schema: "openclaw.custom-runtime-update-survival.v1",
    mode: "candidate-merge",
    sourceSha: candidateSha,
    activeSha,
    officialSha,
    candidateSha,
    mergeParents: parents,
    sourceClean: true,
    contractVersion: 2,
    sourceStrategy: "merge_from_active_sha",
    dashboardChangePolicy: "register_verify_and_block",
    approvalPolicy: "explicit_exact_candidate",
    proofCommand: "pnpm custom-runtime:update-survival",
    activeManifestVersion: params.activeManifest.version,
    candidateManifestVersion: params.candidateManifest.version,
    verificationCommands: UPDATE_SURVIVAL_VERIFICATION_COMMANDS,
    requiredCapabilities: params.candidateManifest.capabilities.map((capability) => capability.id),
    requiredPathDigests: Object.fromEntries(
      [...requiredPathDigests].toSorted(([a], [b]) => a.localeCompare(b)),
    ),
    checkedAt: params.checkedAt ?? new Date().toISOString(),
    passed: true,
  };
}

function parseArgs(argv: string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--") {
      continue;
    }
    if (!key?.startsWith("--")) {
      throw new Error(`Unknown argument: ${key ?? ""}`);
    }
    const value = argv[++index];
    if (!value) {
      throw new Error(`Missing value for ${key}.`);
    }
    values.set(key.slice(2), value);
  }
  return values;
}

function writeProof(filePath: string, proof: JsonObject): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(proof, null, 2)}\n`, { mode: 0o600 });
}

function sourceContractProof(repoRoot: string, output?: string): string {
  const errors = auditUpdateSurvivalRepository(repoRoot);
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
  const sourceSha = resolveGitSha(repoRoot, "HEAD", "sourceSha");
  if (git(repoRoot, ["status", "--porcelain"]).stdout.trim()) {
    throw new Error("Update-survival source proof requires a clean checkout.");
  }
  const manifestPath = path.join(repoRoot, "config", "custom-runtime-capabilities.json");
  const manifest = parseCustomRuntimeCapabilityManifest(readJson(manifestPath));
  if (!manifest) {
    throw new Error("Current capability manifest became invalid during source proof.");
  }
  const proof: JsonObject = {
    schema: "openclaw.custom-runtime-update-survival.v1",
    mode: "source-contract",
    sourceSha,
    sourceClean: true,
    contractVersion: 2,
    sourceStrategy: "merge_from_active_sha",
    dashboardChangePolicy: "register_verify_and_block",
    approvalPolicy: "explicit_exact_candidate",
    proofCommand: "pnpm custom-runtime:update-survival",
    manifestVersion: manifest.version,
    manifestSha256: sha256(manifestPath),
    verificationCommands: UPDATE_SURVIVAL_VERIFICATION_COMMANDS,
    facts: [
      "capability-manifest",
      "exact-parent-update-broker",
      "proof-bound-approval",
      "managed-stage-and-rollback",
      "managed-runtime-guard",
      "workflow-sanity",
      "control-director-readiness",
      "reliability-skill",
      "M61-roadmap",
    ].map((id) => ({ id, passed: true })),
    checkedAt: new Date().toISOString(),
    evidenceRefs: [
      "config/custom-runtime-capabilities.json",
      "scripts/custom-runtime/custom-runtime-updater.sh",
      "scripts/custom-runtime/custom-runtime-update-approve.sh",
      "test/scripts/custom-runtime-update-survival.test.ts",
    ],
    passed: true,
  };
  const target = path.resolve(
    output ??
      path.join(repoRoot, ".artifacts", "control-director", `update-survival-${sourceSha}.json`),
  );
  writeProof(target, proof);
  return target;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(args.get("repo") ?? DEFAULT_REPO_ROOT);
  const candidateMode =
    args.has("active-sha") || args.has("official-ref") || args.has("candidate-sha");
  if (!candidateMode) {
    const output = sourceContractProof(repoRoot, args.get("output"));
    process.stdout.write(`${output}\n`);
    return;
  }
  for (const key of [
    "active-sha",
    "official-ref",
    "candidate-sha",
    "active-manifest",
    "candidate-manifest",
    "output",
  ]) {
    if (!args.get(key)) {
      throw new Error(`Missing --${key}.`);
    }
  }
  const wiringErrors = auditUpdateSurvivalRepository(repoRoot);
  if (wiringErrors.length > 0) {
    throw new Error(wiringErrors.join("\n"));
  }
  const activeManifest = parsePreviousCapabilityManifest(
    readJson(path.resolve(args.get("active-manifest")!)),
  );
  const candidateManifest = parseCustomRuntimeCapabilityManifest(
    readJson(path.resolve(args.get("candidate-manifest")!)),
  );
  if (!candidateManifest) {
    throw new Error("Candidate capability manifest is invalid.");
  }
  const proof = buildCandidateUpdateSurvivalProof({
    repoRoot,
    activeSha: args.get("active-sha")!,
    officialRef: args.get("official-ref")!,
    candidateSha: args.get("candidate-sha")!,
    activeManifest,
    candidateManifest,
  });
  const output = path.resolve(args.get("output")!);
  writeProof(output, proof);
  process.stdout.write(`${output}\n`);
}

if (path.resolve(process.argv[1] ?? "") === SCRIPT_PATH) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

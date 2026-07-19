#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const EXPECTED_MILESTONES = Array.from(
  { length: 60 },
  (_, index) => `M${String(index + 1).padStart(2, "0")}`,
);
const REQUIRED_TRUTH_SURFACES = [
  "source",
  "targeted-tests",
  "build",
  "full-tests",
  "managed-runtime",
  "dashboard-desktop",
  "dashboard-tablet",
  "dashboard-mobile",
  "restart-recovery",
  "soak",
  "rollback",
];
const REQUIRED_BINDINGS = ["sourceProof", "runtimeProof", "remoteProof", "readiness"];
const RUNTIME_SURFACES = [
  "desktop",
  "tablet",
  "mobile",
  "restartRecovery",
  "soak",
  "rollback",
  "liveDiagnostic",
];

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value;
}

function readJson(filePath) {
  return object(JSON.parse(fs.readFileSync(filePath, "utf8")), filePath);
}

function digest(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function immutableSha(value, label) {
  const sha = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!SHA_PATTERN.test(sha)) throw new Error(`${label} must be an immutable 40-character SHA.`);
  return sha;
}

function exactSha(value, expected, label) {
  if (value !== expected) throw new Error(`${label} sourceSha does not match ${expected}.`);
}

function git(repoRoot, args) {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${String(result.stderr || result.stdout).trim()}`,
    );
  }
  return result.stdout.trim();
}

function resolveBinding(repoRoot, template, sourceSha) {
  if (typeof template !== "string" || !template.includes("<source-sha>")) {
    throw new Error("Evidence binding paths must contain <source-sha>.");
  }
  return path.resolve(repoRoot, template.replaceAll("<source-sha>", sourceSha));
}

export function controlDirectorSourceProofMatchesRoot(proofRoot, repoRoot) {
  return (
    typeof proofRoot === "string" &&
    Boolean(proofRoot.trim()) &&
    path.resolve(proofRoot) === path.resolve(repoRoot)
  );
}

export function validateControlDirectorRoadmap(params) {
  const roadmap = object(params.roadmap, "roadmap");
  const sourceSha = immutableSha(params.sourceSha, "sourceSha");
  if (roadmap.schemaVersion !== 1 || roadmap.programId !== "control-director-reliability-v1") {
    throw new Error("Roadmap identity is not Control Director Reliability V1.");
  }
  const completionPolicy = object(roadmap.completionPolicy, "completionPolicy");
  if (
    completionPolicy.requireAllMilestones !== true ||
    completionPolicy.allowPartialCompletionClaim !== false ||
    Number(completionPolicy.requiredQualityScore) < 93
  ) {
    throw new Error("Roadmap completion policy is weaker than the required contract.");
  }
  const truthSurfaces = Array.isArray(completionPolicy.truthSurfaces)
    ? completionPolicy.truthSurfaces
    : [];
  const missingTruthSurfaces = REQUIRED_TRUTH_SURFACES.filter(
    (surface) => !truthSurfaces.includes(surface),
  );
  if (missingTruthSurfaces.length > 0) {
    throw new Error(`Roadmap is missing truth surfaces: ${missingTruthSurfaces.join(", ")}.`);
  }
  const binding = object(roadmap.evidenceBinding, "evidenceBinding");
  for (const name of REQUIRED_BINDINGS) {
    if (typeof binding[name] !== "string" || !binding[name].includes("<source-sha>")) {
      throw new Error(`evidenceBinding.${name} must contain <source-sha>.`);
    }
  }
  if (typeof binding.finalReceipt !== "string" || !binding.finalReceipt.includes("<source-sha>")) {
    throw new Error("evidenceBinding.finalReceipt must contain <source-sha>.");
  }
  const milestones = Array.isArray(roadmap.milestones)
    ? roadmap.milestones.map((entry) => object(entry, "milestone"))
    : [];
  const milestoneIds = milestones.map((milestone) => milestone.id);
  if (JSON.stringify(milestoneIds) !== JSON.stringify(EXPECTED_MILESTONES)) {
    throw new Error("Roadmap must contain exactly M01 through M60 in order.");
  }
  const byId = new Map(milestones.map((milestone) => [milestone.id, milestone]));
  for (const milestone of milestones) {
    if (milestone.status !== "passed") throw new Error(`${milestone.id} is not passed.`);
    if (typeof milestone.acceptance !== "string" || !milestone.acceptance.trim()) {
      throw new Error(`${milestone.id} has no acceptance contract.`);
    }
    const evidence = Array.isArray(milestone.evidence) ? milestone.evidence : [];
    if (
      evidence.length < 2 ||
      evidence.some((entry) => typeof entry !== "string" || !entry.trim())
    ) {
      throw new Error(`${milestone.id} requires at least two concrete evidence references.`);
    }
    const bindings = evidence.filter((entry) => entry.startsWith("binding:"));
    if (
      bindings.length === 0 ||
      bindings.some((entry) => !REQUIRED_BINDINGS.includes(entry.slice(8)))
    ) {
      throw new Error(`${milestone.id} has no recognized exact-SHA evidence binding.`);
    }
    if (!evidence.some((entry) => /^(?:source|test|doc|runtime|workflow):/u.test(entry))) {
      throw new Error(`${milestone.id} has no milestone-specific evidence reference.`);
    }
    const dependencies = Array.isArray(milestone.dependsOn) ? milestone.dependsOn : [];
    for (const dependency of dependencies) {
      if (byId.get(dependency)?.status !== "passed") {
        throw new Error(`${milestone.id} dependency ${String(dependency)} is not passed.`);
      }
    }
  }

  const sourceProof = object(params.sourceProof, "sourceProof");
  exactSha(sourceProof.sourceSha, sourceSha, "sourceProof");
  if (
    sourceProof.schemaVersion !== 2 ||
    sourceProof.expectedSha !== sourceSha ||
    sourceProof.sourceClean !== true ||
    sourceProof.identityVerified !== true ||
    typeof sourceProof.sourceRoot !== "string" ||
    !sourceProof.sourceRoot.trim() ||
    sourceProof.passed !== true
  ) {
    throw new Error("Source proof is not a clean exact-identity v2 pass.");
  }
  const commands = Array.isArray(sourceProof.commands) ? sourceProof.commands : [];
  if (
    commands.length === 0 ||
    commands.some((entry) => object(entry, "source command").status !== "passed")
  ) {
    throw new Error("Source proof does not contain an all-passed command ledger.");
  }

  const runtimeProof = object(params.runtimeProof, "runtimeProof");
  exactSha(runtimeProof.sourceSha, sourceSha, "runtimeProof");
  if (runtimeProof.schemaVersion !== 2 || runtimeProof.sigBackgroundEnabled !== true) {
    throw new Error("Runtime proof is not the managed SIG-enabled v2 contract.");
  }
  for (const surface of RUNTIME_SURFACES) {
    const value = object(runtimeProof[surface], `runtimeProof.${surface}`);
    exactSha(value.sourceSha, sourceSha, `runtimeProof.${surface}`);
    if (value.passed !== true) {
      throw new Error(`Runtime surface ${surface} has not passed.`);
    }
  }
  const modelEval = object(runtimeProof.modelEval, "runtimeProof.modelEval");
  if (
    modelEval.passed !== true ||
    modelEval.exactRuntime !== true ||
    modelEval.passRate !== 100 ||
    modelEval.criticalOmissions !== 0
  ) {
    throw new Error("Runtime model evaluation is not a 100% exact-runtime pass.");
  }
  const modelResults = Array.isArray(modelEval.results) ? modelEval.results : [];
  const qualityScores = modelResults.map((entry) =>
    Number(object(object(entry, "model result").quality, "model quality").score),
  );
  if (
    qualityScores.length === 0 ||
    qualityScores.some(
      (score) => !Number.isFinite(score) || score < Number(completionPolicy.requiredQualityScore),
    )
  ) {
    throw new Error("At least one model-evaluation quality score is below the roadmap minimum.");
  }

  const remoteProof = object(params.remoteProof, "remoteProof");
  exactSha(remoteProof.sourceSha, sourceSha, "remoteProof");
  if (remoteProof.passed !== true) throw new Error("Remote proof has not passed.");
  for (const gate of ["workflowSanity", "nonAndroidCi"]) {
    const value = object(remoteProof[gate], `remoteProof.${gate}`);
    if (
      value.status !== "completed" ||
      value.conclusion !== "success" ||
      value.headSha !== sourceSha ||
      value.acceptedJobs !== value.totalJobs
    ) {
      throw new Error(`${gate} is not an all-jobs exact-SHA success.`);
    }
  }
  const landing = object(remoteProof.landing, "remoteProof.landing");
  if (landing.merged !== true || landing.mergeSha !== sourceSha) {
    throw new Error("Remote landing does not bind the exact source SHA.");
  }

  const readiness = object(params.readiness, "readiness");
  exactSha(readiness.sourceSha, sourceSha, "readiness");
  if (
    readiness.expectedSha !== sourceSha ||
    readiness.sourceReady !== true ||
    readiness.productionReady !== true ||
    readiness.passPercent !== 100 ||
    readiness.mode !== "production"
  ) {
    throw new Error("Production readiness is not an exact-SHA 100% pass.");
  }

  return {
    milestoneCount: milestones.length,
    passedMilestones: milestones.length,
    weightedCompletionPercent: 100,
    minimumQualityScore: Math.min(...qualityScores),
    requiredQualityScore: Number(completionPolicy.requiredQualityScore),
    evidenceBinding: binding,
  };
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--") continue;
    if (!key?.startsWith("--")) throw new Error(`Unknown argument: ${key ?? ""}`);
    const value = argv[++index];
    if (!value) throw new Error(`Missing value for ${key}.`);
    values.set(key.slice(2), value);
  }
  for (const key of [
    "source-sha",
    "roadmap",
    "source-proof",
    "runtime-proof",
    "remote-proof",
    "readiness",
    "output",
  ]) {
    if (!values.get(key)) throw new Error(`Missing --${key}.`);
  }
  return values;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceSha = immutableSha(args.get("source-sha"), "sourceSha");
  const roadmapPath = path.resolve(args.get("roadmap"));
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const head = git(repoRoot, ["rev-parse", "HEAD"]).toLowerCase();
  if (head !== sourceSha) throw new Error(`HEAD ${head} does not match ${sourceSha}.`);
  if (git(repoRoot, ["status", "--porcelain=v1", "--untracked-files=all"])) {
    throw new Error("Source checkout is not clean.");
  }
  const inputPaths = {
    sourceProof: path.resolve(args.get("source-proof")),
    runtimeProof: path.resolve(args.get("runtime-proof")),
    remoteProof: path.resolve(args.get("remote-proof")),
    readiness: path.resolve(args.get("readiness")),
  };
  const roadmap = readJson(roadmapPath);
  const sourceProof = readJson(inputPaths.sourceProof);
  if (!controlDirectorSourceProofMatchesRoot(sourceProof.sourceRoot, repoRoot)) {
    throw new Error("sourceProof sourceRoot does not match the current repository root.");
  }
  const validation = validateControlDirectorRoadmap({
    roadmap,
    sourceSha,
    sourceProof,
    runtimeProof: readJson(inputPaths.runtimeProof),
    remoteProof: readJson(inputPaths.remoteProof),
    readiness: readJson(inputPaths.readiness),
  });
  const bindings = object(roadmap.evidenceBinding, "evidenceBinding");
  for (const [name, inputPath] of Object.entries(inputPaths)) {
    const expected = resolveBinding(repoRoot, bindings[name], sourceSha);
    if (expected !== inputPath) throw new Error(`${name} path does not match its roadmap binding.`);
  }
  const output = path.resolve(args.get("output"));
  const expectedOutput = resolveBinding(repoRoot, bindings.finalReceipt, sourceSha);
  if (expectedOutput !== output) {
    throw new Error("output path does not match evidenceBinding.finalReceipt.");
  }
  const receipt = {
    schema: "openclaw.control-director-final-ledger.v1",
    sourceSha,
    checkedAt: new Date().toISOString(),
    passed: true,
    ...validation,
    artifacts: {
      roadmap: { path: roadmapPath, sha256: digest(roadmapPath) },
      ...Object.fromEntries(
        Object.entries(inputPaths).map(([name, filePath]) => [
          name,
          { path: filePath, sha256: digest(filePath) },
        ]),
      ),
    },
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${output}\n`);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

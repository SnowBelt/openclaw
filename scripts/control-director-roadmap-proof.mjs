#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash, createPublicKey } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  buildControlDirectorModelEvalMatrix,
  parseControlDirectorModelEvalTrials,
} from "../src/agents/control-director-model-eval.js";
import {
  CONTROL_DIRECTOR_MODEL_GOVERNANCE_FACT_IDS,
  CONTROL_DIRECTOR_MODEL_GOVERNANCE_PROOF_SCHEMA,
  CONTROL_DIRECTOR_STABILITY_FACT_IDS,
  CONTROL_DIRECTOR_STABILITY_PROOF_SCHEMA,
  buildControlDirectorStabilityProof,
  buildControlDirectorCacheIdentityEvidence,
  digestControlDirectorStatisticalTrials,
  digestModelGovernanceIdentity,
} from "../src/agents/control-director-model-governance-proof.js";
import { CONTROL_DIRECTOR_UX_SLOS } from "../src/agents/control-director-slos.js";
import { resolveStateDir } from "../src/config/paths.js";
import {
  CONTROL_DIRECTOR_CAPABILITY_IDS,
  CONTROL_DIRECTOR_CAPABILITY_PROBE_REQUIREMENTS,
  verifyControlDirectorCapabilityObservation,
} from "./control-director-capability-observer.mjs";
import {
  auditControlDirectorMilestones,
  MILESTONE_EVIDENCE_CONTRACTS,
} from "./control-director-milestone-audit.mjs";
import {
  verifyControlDirectorJudgeEvidence,
  verifyControlDirectorRuntimeSoak,
} from "./control-director-runtime-proof.ts";
import { verifyControlDirectorRuntimeIdentityEvidence } from "./control-director-stability-monitor.mjs";

const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const CANONICAL_ROADMAP_PATH = "work/control-director/reliability-v1/roadmap.json";
const REQUIRED_CAPABILITY_COUNT = 35;
const EXPECTED_MILESTONES = Array.from(
  { length: 106 },
  (_, index) => `M${String(index + 1).padStart(2, "0")}`,
);
const IMPLEMENTATION_STATUSES = new Set(["unassessed", "pending", "implemented", "blocked"]);
const CERTIFICATION_STATUSES = new Set(["pending", "passed", "blocked"]);
const REQUIRED_TRUTH_SURFACES = [
  "source",
  "targeted-tests",
  "build",
  "full-tests",
  "mac-studio-source-validation",
  "landing",
  "update-survival",
  "managed-runtime",
  "mac-studio-dashboard",
  "local-model-routing",
  "local-model-latency",
  "memory",
  "delegation",
  "judge",
  "sig",
  "pcc",
  "queue",
  "steer",
  "cancel",
  "pursue-goal",
  "restart-recovery",
  "soak",
  "rollback",
  "live-diagnostic",
  "model-identity",
  "evidence-invalidation",
  "configuration-residency",
  "latency-telemetry",
  "fallback-governance",
  "quality-cascade",
  "shadow-review",
  "judge-diversity",
  "statistical-evaluation",
  "cache-identity",
  "immutable-runtime-invocation",
  "pcc-observability",
  "sig-incidents",
  "proof-planning",
  "workflow-skill-convergence",
  "chaos-drill",
  "rollback-restoration",
  "extended-soak",
  "final-ledger",
];
const REQUIRED_BINDINGS = [
  "sourceProof",
  "updateSurvival",
  "runtimeProof",
  "localValidationProof",
  "readiness",
  "modelGovernanceProof",
  "stabilityProof",
  "capabilityProof",
];
const UPDATE_SURVIVAL_COMMANDS = [
  "pnpm check:custom-runtime-capabilities",
  "pnpm check:pcc-capabilities",
  "pnpm control-director:verify -- --expected-sha <candidate-sha>",
  "pnpm check",
  "pnpm ui:build",
  "pnpm build",
  "pnpm ui:smoke:dashboard --artifact-profile release --artifact-root .artifacts/custom-runtime-update",
];
const RUNTIME_SURFACES = [
  "macStudioDashboard",
  "localModelRouting",
  "localModelLatency",
  "memory",
  "delegation",
  "judge",
  "sig",
  "pcc",
  "queue",
  "steer",
  "cancel",
  "pursueGoal",
  "restartRecovery",
  "soak",
  "rollback",
  "liveDiagnostic",
];
const REQUIRED_LOCAL_VALIDATION_GATES = [
  "targeted-tests",
  "source-check",
  "full-tests",
  "workflow-sanity",
  "build",
  "browser-mac-studio",
  "independent-review",
];
const MODEL_EVAL_TASK_CLASSES = [
  "conversation",
  "recall",
  "planning",
  "delegation",
  "steering",
  "verification",
];
const MINIMUM_SOAK_MS = 30 * 60 * 1_000;
const REQUIRED_SOURCE_COMMANDS = [
  "protocol-coverage",
  "protocol-generated",
  "torture",
  "chaos",
  "tests",
  "ui-tests",
  "extension-tests",
  "ui-i18n",
  "deployment-consistency",
  "custom-runtime-contracts",
  "update-survival",
  "pcc-contracts",
  "plugin-sdk-api",
  "docs-mdx",
  "docs-links",
  "lint-scripts",
  "format-check",
  "typecheck-core",
  "typecheck-ui",
  "typecheck-extensions",
  "build",
];
const REQUIRED_UPDATE_SURVIVAL_FACTS = [
  "capability-manifest",
  "exact-parent-update-broker",
  "proof-bound-approval",
  "managed-stage-and-rollback",
  "managed-runtime-guard",
  "workflow-sanity",
  "control-director-readiness",
  "reliability-skill",
  "M61-roadmap",
];
const REQUIRED_READINESS_FACTS = [
  "immutable-source",
  "expected-source",
  "clean-source",
  "canonical-root",
  "wiring-updateSafeCustomizationLifecycle",
  "gate-torture",
  "gate-chaos",
  "gate-chat-stack",
  "gate-typecheck",
  "gate-tests",
  "gate-build",
  "runtime-proof",
  "runtime-proof-contract",
  "runtime-lineage",
  "runtime-sig-background",
  "runtime-update-broker",
  "runtime-recovery-guard",
  "runtime-config-digest",
  "runtime-model-digest",
  "runtime-ollama-env",
  "runtime-model-smoke",
  "runtime-model-eval",
  ...RUNTIME_SURFACES.map((surface) => `runtime-${surface}`),
];
const REQUIRED_MILESTONE_BINDINGS = {
  M61: ["sourceProof", "updateSurvival", "runtimeProof", "readiness"],
  M66: ["runtimeProof"],
  M67: ["runtimeProof"],
  M68: ["sourceProof", "updateSurvival", "runtimeProof", "localValidationProof", "readiness"],
  M85: ["runtimeProof", "readiness"],
  M86: ["sourceProof", "updateSurvival", "runtimeProof", "localValidationProof", "readiness"],
  M87: ["modelGovernanceProof"],
  M88: ["modelGovernanceProof"],
  M89: ["modelGovernanceProof"],
  M90: ["modelGovernanceProof"],
  M91: ["modelGovernanceProof"],
  M92: ["modelGovernanceProof"],
  M93: ["modelGovernanceProof"],
  M94: ["modelGovernanceProof"],
  M95: ["modelGovernanceProof"],
  M96: ["modelGovernanceProof"],
  M97: ["modelGovernanceProof"],
  M98: ["modelGovernanceProof"],
  M99: ["modelGovernanceProof"],
  M100: ["modelGovernanceProof"],
  M101: ["modelGovernanceProof"],
  M102: ["modelGovernanceProof"],
  M103: ["stabilityProof"],
  M104: ["stabilityProof"],
  M105: ["stabilityProof"],
  M106: [
    "sourceProof",
    "updateSurvival",
    "runtimeProof",
    "localValidationProof",
    "readiness",
    "modelGovernanceProof",
    "stabilityProof",
  ],
};
const REQUIRED_MODEL_GOVERNANCE_FACTS = [...CONTROL_DIRECTOR_MODEL_GOVERNANCE_FACT_IDS];
const REQUIRED_STABILITY_FACTS = [...CONTROL_DIRECTOR_STABILITY_FACT_IDS];

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value;
}

function readJson(filePath) {
  return object(JSON.parse(fs.readFileSync(filePath, "utf8")), filePath);
}

function readContainedArtifact(repoRoot, bindingValue) {
  const binding = object(bindingValue, "artifact binding");
  const candidate = path.resolve(repoRoot, requiredString(binding.path, "artifact binding.path"));
  const relative = path.relative(repoRoot, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return undefined;
  }
  try {
    return fs.statSync(candidate).isFile() ? fs.readFileSync(candidate) : undefined;
  } catch {
    return undefined;
  }
}

function digest(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function digestText(value) {
  return createHash("sha256").update(value).digest("hex");
}

function immutableSha(value, label) {
  const sha = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!SHA_PATTERN.test(sha)) {
    throw new Error(`${label} must be an immutable 40-character SHA.`);
  }
  return sha;
}

function exactSha(value, expected, label) {
  if (value !== expected) {
    throw new Error(`${label} sourceSha does not match ${expected}.`);
  }
}

function validDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function nonEmptyStrings(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string" && Boolean(entry.trim()))
    : [];
}

function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} requires a non-empty string.`);
  }
  return value.trim();
}

function typedIdentity(value, label) {
  requiredString(value, label);
  if (!/^[A-Za-z0-9._:@/+~-]{1,160}$/u.test(value)) {
    throw new Error(`${label} must be a bounded typed identity.`);
  }
  return value;
}

function requiredTrue(value, label) {
  if (value !== true) {
    throw new Error(`${label} must be true.`);
  }
}

function finiteNonNegative(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} requires a non-negative finite number.`);
  }
  return value;
}

function validateLatencySample(value, label, substantiveResponseLimitMs) {
  const sample = object(value, label);
  for (const [field, limit] of [
    ["ackMs", CONTROL_DIRECTOR_UX_SLOS.ackMs],
    ["firstActivityMs", CONTROL_DIRECTOR_UX_SLOS.firstActivityMs],
    ["maximumActivityGapMs", CONTROL_DIRECTOR_UX_SLOS.activityHeartbeatMs],
    ["cancelAckMs", CONTROL_DIRECTOR_UX_SLOS.cancelAckMs],
    ["substantiveResponseMs", substantiveResponseLimitMs],
  ]) {
    if (finiteNonNegative(sample[field], `${label}.${field}`) > limit) {
      throw new Error(`${label}.${field} exceeds the ${limit}ms Control Director SLO.`);
    }
  }
}

function validateRuntimeSurfaceContract(name, surface) {
  if (name === "macStudioDashboard") {
    if (surface.platform !== "mac-studio") {
      throw new Error("runtimeProof.macStudioDashboard.platform must be mac-studio.");
    }
    const host = object(surface.host, "runtimeProof.macStudioDashboard.host");
    if (
      host.hardwareClass !== "Mac Studio" ||
      host.osName !== "macOS" ||
      host.architecture !== "arm64"
    ) {
      throw new Error(
        "runtimeProof.macStudioDashboard.host must identify an arm64 Mac Studio running macOS.",
      );
    }
    requiredString(host.osVersion, "runtimeProof.macStudioDashboard.host.osVersion");
    if (!SHA256_PATTERN.test(String(host.hostIdentitySha256 ?? ""))) {
      throw new Error(
        "runtimeProof.macStudioDashboard.host.hostIdentitySha256 must be a 64-character digest.",
      );
    }
    requiredString(surface.browserName, "runtimeProof.macStudioDashboard.browserName");
    requiredString(surface.browserVersion, "runtimeProof.macStudioDashboard.browserVersion");
    const viewport = object(surface.viewport, "runtimeProof.macStudioDashboard.viewport");
    if (
      finiteNonNegative(viewport.width, "runtimeProof.macStudioDashboard.viewport.width") <= 0 ||
      finiteNonNegative(viewport.height, "runtimeProof.macStudioDashboard.viewport.height") <= 0
    ) {
      throw new Error("Mac Studio Dashboard viewport dimensions must be positive.");
    }
    for (const field of [
      "transcriptVisible",
      "composerVisible",
      "keyboardPassed",
      "accessibilityPassed",
      "pccOverlapFree",
      "truthCompletionOverlapFree",
    ]) {
      requiredTrue(surface[field], `runtimeProof.macStudioDashboard.${field}`);
    }
    return;
  }
  switch (name) {
    case "localModelRouting":
      if (surface.route !== "local") {
        throw new Error("runtimeProof.localModelRouting.route must be local.");
      }
      requiredString(surface.modelRef, "runtimeProof.localModelRouting.modelRef");
      if (
        finiteNonNegative(surface.qualityScore, "runtimeProof.localModelRouting.qualityScore") < 93
      ) {
        throw new Error("runtimeProof.localModelRouting.qualityScore must be at least 93.");
      }
      return;
    case "localModelLatency":
      validateLatencySample(
        surface.cold,
        "runtimeProof.localModelLatency.cold",
        CONTROL_DIRECTOR_UX_SLOS.coldSubstantiveResponseMs,
      );
      validateLatencySample(
        surface.warm,
        "runtimeProof.localModelLatency.warm",
        CONTROL_DIRECTOR_UX_SLOS.warmSubstantiveResponseMs,
      );
      return;
    case "memory":
      if (finiteNonNegative(surface.recentRecallTopK, "runtimeProof.memory.recentRecallTopK") < 3) {
        throw new Error("runtimeProof.memory.recentRecallTopK must be at least 3.");
      }
      requiredTrue(surface.recallPassed, "runtimeProof.memory.recallPassed");
      requiredTrue(surface.provenanceVerified, "runtimeProof.memory.provenanceVerified");
      return;
    case "delegation":
      for (const field of ["controlDirectorRunId", "programManagerRunId", "workerRunId"]) {
        requiredString(surface[field], `runtimeProof.delegation.${field}`);
      }
      requiredTrue(surface.taskRootVerified, "runtimeProof.delegation.taskRootVerified");
      requiredTrue(surface.handoffVerified, "runtimeProof.delegation.handoffVerified");
      return;
    case "judge":
      object(surface.claim, "runtimeProof.judge.claim");
      object(surface.receipt, "runtimeProof.judge.receipt");
      return;
    case "sig":
      requiredString(surface.auditEventId, "runtimeProof.sig.auditEventId");
      requiredTrue(surface.ingested, "runtimeProof.sig.ingested");
      requiredTrue(surface.routed, "runtimeProof.sig.routed");
      requiredTrue(surface.backgroundEnabled, "runtimeProof.sig.backgroundEnabled");
      return;
    case "pcc":
      requiredString(surface.projectId, "runtimeProof.pcc.projectId");
      requiredTrue(surface.stateConsistent, "runtimeProof.pcc.stateConsistent");
      requiredTrue(
        surface.evidenceProjectionVerified,
        "runtimeProof.pcc.evidenceProjectionVerified",
      );
      return;
    case "queue":
      requiredString(surface.queuedTurnId, "runtimeProof.queue.queuedTurnId");
      requiredTrue(surface.accepted, "runtimeProof.queue.accepted");
      requiredTrue(surface.processed, "runtimeProof.queue.processed");
      requiredTrue(surface.orderPreserved, "runtimeProof.queue.orderPreserved");
      return;
    case "steer":
      requiredString(surface.steerTurnId, "runtimeProof.steer.steerTurnId");
      requiredTrue(surface.accepted, "runtimeProof.steer.accepted");
      requiredTrue(surface.applied, "runtimeProof.steer.applied");
      requiredTrue(surface.activeRunPreserved, "runtimeProof.steer.activeRunPreserved");
      return;
    case "cancel":
      requiredString(surface.cancelId, "runtimeProof.cancel.cancelId");
      requiredTrue(surface.accepted, "runtimeProof.cancel.accepted");
      requiredTrue(surface.workStopped, "runtimeProof.cancel.workStopped");
      requiredTrue(surface.staleRunningCleared, "runtimeProof.cancel.staleRunningCleared");
      return;
    case "pursueGoal":
      requiredString(surface.goalId, "runtimeProof.pursueGoal.goalId");
      requiredString(surface.missionId, "runtimeProof.pursueGoal.missionId");
      if (
        nonEmptyStrings(surface.artifactIds).length === 0 ||
        new Set(nonEmptyStrings(surface.artifactIds)).size !==
          nonEmptyStrings(surface.artifactIds).length ||
        !validDate(surface.startedAt)
      ) {
        throw new Error("runtimeProof.pursueGoal requires a started mission and unique artifacts.");
      }
      requiredTrue(surface.leaseObserved, "runtimeProof.pursueGoal.leaseObserved");
      requiredTrue(surface.progressObserved, "runtimeProof.pursueGoal.progressObserved");
      requiredTrue(surface.resumeVerified, "runtimeProof.pursueGoal.resumeVerified");
      requiredTrue(surface.stopVerified, "runtimeProof.pursueGoal.stopVerified");
      return;
    case "restartRecovery":
      requiredString(surface.restartId, "runtimeProof.restartRecovery.restartId");
      requiredTrue(surface.serviceHealthy, "runtimeProof.restartRecovery.serviceHealthy");
      requiredTrue(surface.goalRecovered, "runtimeProof.restartRecovery.goalRecovered");
      requiredTrue(
        surface.pendingTurnsRecovered,
        "runtimeProof.restartRecovery.pendingTurnsRecovered",
      );
      return;
    case "rollback":
      immutableSha(surface.rollbackSha, "runtimeProof.rollback.rollbackSha");
      requiredTrue(surface.restored, "runtimeProof.rollback.restored");
      requiredTrue(surface.serviceHealthy, "runtimeProof.rollback.serviceHealthy");
      return;
    case "liveDiagnostic":
      requiredString(surface.sessionId, "runtimeProof.liveDiagnostic.sessionId");
      requiredTrue(surface.ackObserved, "runtimeProof.liveDiagnostic.ackObserved");
      requiredTrue(surface.activityObserved, "runtimeProof.liveDiagnostic.activityObserved");
      requiredTrue(
        surface.finalResponseReceived,
        "runtimeProof.liveDiagnostic.finalResponseReceived",
      );
      return;
    case "soak":
      return;
    default:
      throw new Error(`Unknown runtime surface ${name}.`);
  }
}

function validateRuntimeSurface(name, value, sourceSha) {
  const surface = object(value, `runtimeProof.${name}`);
  exactSha(surface.sourceSha, sourceSha, `runtimeProof.${name}`);
  if (
    surface.passed !== true ||
    !validDate(surface.checkedAt) ||
    nonEmptyStrings(surface.evidenceRefs).length === 0
  ) {
    throw new Error(`Runtime surface ${name} is not a timestamped evidence-backed pass.`);
  }
  validateRuntimeSurfaceContract(name, surface);
  if (name === "soak") {
    const durationMs = Number(surface.durationMs);
    const startedAt = Date.parse(String(surface.startedAt ?? ""));
    const endedAt = Date.parse(String(surface.endedAt ?? ""));
    if (
      !Number.isFinite(durationMs) ||
      durationMs < MINIMUM_SOAK_MS ||
      !Number.isFinite(startedAt) ||
      !Number.isFinite(endedAt) ||
      endedAt - startedAt < durationMs
    ) {
      throw new Error(`Runtime soak does not prove at least ${MINIMUM_SOAK_MS}ms.`);
    }
  }
  return surface;
}

function validateRequiredFactLedger(value, label, requiredFacts) {
  const facts = Array.isArray(value) ? value.map((entry) => object(entry, `${label} fact`)) : [];
  if (
    facts.length === 0 ||
    facts.some(
      (entry) =>
        typeof entry.id !== "string" ||
        !entry.id.trim() ||
        entry.passed !== true ||
        !validDate(entry.checkedAt) ||
        nonEmptyStrings(entry.evidenceRefs).length === 0,
    )
  ) {
    throw new Error(`${label} does not contain an all-passed timestamped fact ledger.`);
  }
  const factIds = new Set(facts.map((entry) => entry.id));
  const missingFacts = requiredFacts.filter((factId) => !factIds.has(factId));
  if (missingFacts.length > 0) {
    throw new Error(`${label} omits required facts: ${missingFacts.join(", ")}.`);
  }
  return facts;
}

function git(repoRoot, args) {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout.trim();
}

function resolveBinding(repoRoot, template, sourceSha) {
  if (typeof template !== "string" || !template.includes("<source-sha>")) {
    throw new Error("Evidence binding paths must contain <source-sha>.");
  }
  return path.resolve(repoRoot, template.replaceAll("<source-sha>", sourceSha));
}

export function controlDirectorRoadmapPathMatchesCanonical(roadmapPath, repoRoot) {
  return path.resolve(roadmapPath) === path.resolve(repoRoot, CANONICAL_ROADMAP_PATH);
}

export function controlDirectorSourceProofMatchesRoot(proofRoot, repoRoot) {
  return (
    typeof proofRoot === "string" &&
    Boolean(proofRoot.trim()) &&
    path.resolve(proofRoot) === path.resolve(repoRoot)
  );
}

function milestoneProgress(milestone) {
  const certificationStatus = milestone.certificationStatus ?? milestone.status;
  const implementationStatus =
    milestone.implementationStatus ??
    (milestone.status === "passed" ? "implemented" : "unassessed");
  return { certificationStatus, implementationStatus };
}

function validateMilestoneGraph(milestones) {
  const byId = new Map(milestones.map((milestone) => [milestone.id, milestone]));
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) {
      throw new Error(`Roadmap dependency graph contains a cycle at ${id}.`);
    }
    if (visited.has(id)) {
      return;
    }
    const milestone = byId.get(id);
    if (!milestone) {
      throw new Error(`Roadmap dependency ${id} does not exist.`);
    }
    visiting.add(id);
    for (const dependency of Array.isArray(milestone.dependsOn) ? milestone.dependsOn : []) {
      if (!byId.has(dependency)) {
        throw new Error(`${id} dependency ${String(dependency)} does not exist.`);
      }
      visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of byId.keys()) {
    visit(id);
  }
}

export function summarizeControlDirectorProgress(roadmapValue) {
  const roadmap = object(roadmapValue, "roadmap");
  if (roadmap.schemaVersion !== 3 || roadmap.programId !== "control-director-reliability-v1") {
    throw new Error("Roadmap identity is not Mac Studio Control Director Reliability V3.");
  }
  const progressModel = object(roadmap.progressModel, "progressModel");
  if (
    progressModel.officialCompletionField !== "certificationStatus" ||
    progressModel.legacyCertificationMirrorField !== "status" ||
    progressModel.defaultImplementationStatus !== "unassessed" ||
    progressModel.defaultCertificationStatusFrom !== "status"
  ) {
    throw new Error("Roadmap progress model is not the required dual-progress contract.");
  }
  const milestones = Array.isArray(roadmap.milestones)
    ? roadmap.milestones.map((entry) => object(entry, "milestone"))
    : [];
  const milestoneIds = milestones.map((milestone) => milestone.id);
  if (JSON.stringify(milestoneIds) !== JSON.stringify(EXPECTED_MILESTONES)) {
    throw new Error("Roadmap must contain exactly M01 through M106 in stable ID order.");
  }
  for (const milestone of milestones) {
    const { certificationStatus, implementationStatus } = milestoneProgress(milestone);
    if (!IMPLEMENTATION_STATUSES.has(implementationStatus)) {
      throw new Error(`${milestone.id} implementationStatus is invalid.`);
    }
    if (!CERTIFICATION_STATUSES.has(certificationStatus)) {
      throw new Error(`${milestone.id} certificationStatus is invalid.`);
    }
    if (milestone.certificationStatus !== undefined && milestone.status !== certificationStatus) {
      throw new Error(`${milestone.id} status does not mirror certificationStatus.`);
    }
  }
  validateMilestoneGraph(milestones);
  const executionWaves = Array.isArray(roadmap.executionWaves)
    ? roadmap.executionWaves.map((entry) => object(entry, "execution wave"))
    : [];
  const executionIds = executionWaves.flatMap((wave) =>
    Array.isArray(wave.milestones) ? wave.milestones : [],
  );
  const duplicateExecutionIds = executionIds.filter(
    (id, index) => executionIds.indexOf(id) !== index,
  );
  if (duplicateExecutionIds.length > 0) {
    throw new Error(
      `Execution waves contain duplicate milestones: ${duplicateExecutionIds.join(", ")}.`,
    );
  }
  const missingExpandedMilestones = EXPECTED_MILESTONES.slice(68).filter(
    (id) => !executionIds.includes(id),
  );
  if (missingExpandedMilestones.length > 0) {
    throw new Error(
      `Execution waves omit expanded milestones: ${missingExpandedMilestones.join(", ")}.`,
    );
  }
  const implemented = milestones.filter(
    (milestone) => milestoneProgress(milestone).implementationStatus === "implemented",
  ).length;
  const certified = milestones.filter(
    (milestone) => milestoneProgress(milestone).certificationStatus === "passed",
  ).length;
  return {
    milestoneCount: milestones.length,
    implementedMilestones: implemented,
    certifiedMilestones: certified,
    implementationPercent: Number(((implemented / milestones.length) * 100).toFixed(2)),
    certificationPercent: Number(((certified / milestones.length) * 100).toFixed(2)),
  };
}

function evidencePath(kind, value) {
  return `${kind}:${value}`;
}

export function buildCertifiedControlDirectorRoadmapProjection({
  roadmap,
  milestoneAudit,
  finalReceiptPath,
  finalReceiptSha256,
}) {
  const projection = structuredClone(object(roadmap, "roadmap"));
  const audit = object(milestoneAudit, "milestoneAudit");
  const auditedMilestones = Array.isArray(audit.milestones) ? audit.milestones : [];
  const auditById = new Map(auditedMilestones.map((entry) => [entry.id, entry]));
  if (
    audit.summary?.implemented !== EXPECTED_MILESTONES.length ||
    auditedMilestones.length !== EXPECTED_MILESTONES.length
  ) {
    throw new Error("Milestone audit does not prove all 106 implementation contracts.");
  }
  const contractsById = new Map(MILESTONE_EVIDENCE_CONTRACTS.map((entry) => [entry.id, entry]));
  const certificationBindings = {};
  projection.milestones = projection.milestones.map((milestone) => {
    const audited = auditById.get(milestone.id);
    const contract = contractsById.get(milestone.id);
    if (audited?.implementation?.status !== "implemented" || !contract) {
      throw new Error(`${milestone.id} lacks a complete implementation and corroboration audit.`);
    }
    const sourceEvidence = contract.implementationPaths.map((entry) =>
      evidencePath("source", entry),
    );
    const corroborationEvidence = contract.corroborationPaths.map((entry) =>
      evidencePath(entry.startsWith("docs/") ? "doc" : "test", entry),
    );
    const bindings = REQUIRED_BINDINGS.map((entry) => `binding:${entry}`);
    const evidence = [...bindings, ...sourceEvidence, ...corroborationEvidence];
    if (milestone.id === "M106" && finalReceiptPath && finalReceiptSha256) {
      evidence.push(`ledger:${finalReceiptPath}#sha256=${finalReceiptSha256}`);
    }
    certificationBindings[milestone.id] = {
      bindings: [...REQUIRED_BINDINGS],
      finalReceipt:
        milestone.id === "M106" && finalReceiptPath && finalReceiptSha256
          ? { path: finalReceiptPath, sha256: finalReceiptSha256 }
          : null,
    };
    return {
      ...milestone,
      status: "passed",
      implementationStatus: "implemented",
      certificationStatus: "passed",
      evidence,
    };
  });
  projection.projection = {
    kind: "exact-sha-certified-roadmap",
    sourceRoadmap: CANONICAL_ROADMAP_PATH,
    trackedRoadmapMutated: false,
    nonHumanCertificationPercent: 100,
    ownerAcceptance: {
      required: true,
      owner: "Matthew",
      status: "pending",
    },
  };
  projection.certificationBindings = certificationBindings;
  return projection;
}

function validateProjectionContract(roadmap, finalReceiptPath, finalReceiptSha256) {
  const projection = object(roadmap.projection, "roadmap.projection");
  if (
    projection.kind !== "exact-sha-certified-roadmap" ||
    projection.sourceRoadmap !== CANONICAL_ROADMAP_PATH ||
    projection.trackedRoadmapMutated !== false ||
    projection.nonHumanCertificationPercent !== 100 ||
    projection.ownerAcceptance?.required !== true ||
    projection.ownerAcceptance?.owner !== "Matthew" ||
    projection.ownerAcceptance?.status !== "pending"
  ) {
    throw new Error("Certified roadmap projection metadata is not fail-closed.");
  }
  const matrix = object(roadmap.certificationBindings, "roadmap.certificationBindings");
  if (JSON.stringify(Object.keys(matrix)) !== JSON.stringify(EXPECTED_MILESTONES)) {
    throw new Error("Certified roadmap projection must bind exactly M01 through M106.");
  }
  for (const milestoneId of EXPECTED_MILESTONES) {
    const entry = object(matrix[milestoneId], `certificationBindings.${milestoneId}`);
    if (JSON.stringify(entry.bindings) !== JSON.stringify(REQUIRED_BINDINGS)) {
      throw new Error(`${milestoneId} certification binding matrix is incomplete.`);
    }
    if (milestoneId !== "M106" && entry.finalReceipt !== null) {
      throw new Error(`${milestoneId} must not claim the final receipt.`);
    }
  }
  const finalBinding = object(matrix.M106.finalReceipt, "certificationBindings.M106.finalReceipt");
  if (
    finalBinding.path !== finalReceiptPath ||
    finalBinding.sha256 !== finalReceiptSha256 ||
    !SHA256_PATTERN.test(finalBinding.sha256)
  ) {
    throw new Error("M106 is not bound to the exact final-ledger path and digest.");
  }
}

function validateCapabilityProof(
  capabilityProof,
  sourceSha,
  expectedConfigDigests,
  capabilityManifest,
  expectedAuthorizationBindings,
  expectedModel,
  verifyCapabilityArtifact,
) {
  const proof = object(capabilityProof, "capabilityProof");
  exactSha(proof.sourceSha, sourceSha, "capabilityProof");
  if (
    proof.schema !== "openclaw.control-director-capability-proof.v3" ||
    proof.passed !== true ||
    !validDate(proof.checkedAt) ||
    `ollama/${String(proof.selectedModelId ?? "")}` !== expectedModel ||
    JSON.stringify(proof.configurationDigests) !== JSON.stringify(expectedConfigDigests)
  ) {
    throw new Error("Capability proof is not an exact-SHA derived configuration-bound v3 ledger.");
  }
  if (
    expectedAuthorizationBindings &&
    JSON.stringify(proof.authorizationBindings) !== JSON.stringify(expectedAuthorizationBindings)
  ) {
    throw new Error("Capability proof does not match the authorized lifecycle identities.");
  }
  const manifestCapabilities = Array.isArray(capabilityManifest.capabilities)
    ? capabilityManifest.capabilities
    : [];
  const expectedIds = manifestCapabilities
    .map((entry) => {
      requiredString(entry.id, "capability manifest id");
      return entry.id;
    })
    .toSorted();
  if (
    expectedIds.length !== REQUIRED_CAPABILITY_COUNT ||
    new Set(expectedIds).size !== REQUIRED_CAPABILITY_COUNT ||
    JSON.stringify(expectedIds) !== JSON.stringify(CONTROL_DIRECTOR_CAPABILITY_IDS)
  ) {
    throw new Error("Capability manifest does not contain exactly 35 capabilities.");
  }
  const manifestById = new Map(manifestCapabilities.map((entry) => [entry.id, entry]));
  const phases = object(proof.phases, "capabilityProof.phases");
  const observationDigests = object(proof.observationDigests, "capabilityProof.observationDigests");
  let previousCheckedAt = Number.NEGATIVE_INFINITY;
  let previousObservationSha256 = null;
  for (const phaseName of ["active", "rollback", "restored"]) {
    const phase = object(phases[phaseName], `capabilityProof.phases.${phaseName}`);
    const rejectCallerOutcomes = (value, label) => {
      if (Array.isArray(value)) {
        value.forEach((entry, index) => rejectCallerOutcomes(entry, `${label}[${index}]`));
      } else if (value && typeof value === "object") {
        for (const [key, entry] of Object.entries(value)) {
          if (["status", "evidenceRefs", "passed"].includes(key)) {
            throw new Error(
              `${label} contains forbidden caller-authored capability outcome ${key}.`,
            );
          }
          rejectCallerOutcomes(entry, `${label}.${key}`);
        }
      }
    };
    rejectCallerOutcomes(phase, `capabilityProof.phases.${phaseName}`);
    const expectedPhaseSha =
      phaseName === "rollback" ? expectedAuthorizationBindings.rollbackSha : sourceSha;
    const expectedReleaseId =
      phaseName === "rollback"
        ? expectedAuthorizationBindings.rollbackReleaseId
        : expectedAuthorizationBindings.activeReleaseId;
    const checkedAt = Date.parse(phase.checkedAt);
    const startedAt = Date.parse(phase.startedAt);
    const unsignedPhase = { ...phase };
    delete unsignedPhase.contentSha256;
    const canonicalize = (value) => {
      if (Array.isArray(value)) {
        return value.map(canonicalize);
      }
      if (value && typeof value === "object") {
        return Object.fromEntries(
          Object.keys(value)
            .toSorted((left, right) => left.localeCompare(right))
            .map((key) => [key, canonicalize(value[key])]),
        );
      }
      return value;
    };
    const recomputedContentSha256 = createHash("sha256")
      .update(JSON.stringify(canonicalize(unsignedPhase)))
      .digest("hex");
    if (
      phase.schema !== "openclaw.control-director-capability-observation.v2" ||
      phase.phase !== phaseName ||
      phase.sourceSha !== expectedPhaseSha ||
      phase.releaseId !== expectedReleaseId ||
      `ollama/${String(phase.selectedModelId ?? "")}` !== expectedModel ||
      JSON.stringify(phase.configurationDigests) !== JSON.stringify(expectedConfigDigests) ||
      JSON.stringify(phase.authorizationBindings) !==
        JSON.stringify({
          leaseOwner: expectedAuthorizationBindings.leaseOwner,
          approvalId: expectedAuthorizationBindings.approvalId,
          operationId: expectedAuthorizationBindings.operationId,
          invocationId: expectedAuthorizationBindings.invocationId,
        }) ||
      !Number.isFinite(startedAt) ||
      !Number.isFinite(checkedAt) ||
      checkedAt < startedAt ||
      checkedAt <= previousCheckedAt ||
      !SHA256_PATTERN.test(phase.contentSha256) ||
      recomputedContentSha256 !== phase.contentSha256 ||
      observationDigests[phaseName] !== phase.contentSha256 ||
      phase.previousObservationSha256 !== previousObservationSha256
    ) {
      throw new Error(
        `Capability proof ${phaseName} phase has invalid identities, digest, chain, or order.`,
      );
    }
    previousCheckedAt = checkedAt;
    previousObservationSha256 = phase.contentSha256;
    const capabilities = Array.isArray(phase.capabilities) ? phase.capabilities : [];
    const actualIds = capabilities.map((entry) => entry?.id).toSorted();
    if (
      capabilities.length !== REQUIRED_CAPABILITY_COUNT ||
      new Set(actualIds).size !== REQUIRED_CAPABILITY_COUNT ||
      JSON.stringify(actualIds) !== JSON.stringify(expectedIds)
    ) {
      throw new Error(
        `Capability proof ${phaseName} phase does not enumerate exactly the 35 manifest capabilities.`,
      );
    }
    const probes = object(phase.probes, `capabilityProof.phases.${phaseName}.probes`);
    for (const capability of capabilities) {
      const manifestCapability = object(
        manifestById.get(capability.id),
        `capability manifest ${String(capability.id)}`,
      );
      const expectedPathKeys = [...manifestCapability.requiredPaths].toSorted((left, right) =>
        left.localeCompare(right),
      );
      const actualPathDigests = object(
        capability.requiredPathDigests,
        `${phaseName}.${String(capability.id)}.requiredPathDigests`,
      );
      const actualPathKeys = Object.keys(actualPathDigests).toSorted((left, right) =>
        left.localeCompare(right),
      );
      const probeIds = nonEmptyStrings(capability.probeIds);
      const expectedProbeIds = CONTROL_DIRECTOR_CAPABILITY_PROBE_REQUIREMENTS[capability.id];
      const contractProbe = object(
        probes[`capability-contract:${String(capability.id)}`],
        `${phaseName}.capability-contract:${String(capability.id)}`,
      );
      const expectedContractDigest = createHash("sha256")
        .update(
          JSON.stringify(
            Object.fromEntries(
              Object.entries(actualPathDigests).toSorted(([left], [right]) =>
                left.localeCompare(right),
              ),
            ),
          ),
        )
        .digest("hex");
      if (
        capability.kind !== manifestCapability.kind ||
        JSON.stringify(actualPathKeys) !== JSON.stringify(expectedPathKeys) ||
        Object.values(actualPathDigests).some((entry) => !SHA256_PATTERN.test(entry)) ||
        JSON.stringify(probeIds) !== JSON.stringify(expectedProbeIds) ||
        probeIds.some((probeId) => !probes[probeId]) ||
        object(
          contractProbe.parsedResult,
          `${phaseName}.capability-contract:${String(capability.id)}.parsedResult`,
        ).digest !== expectedContractDigest
      ) {
        throw new Error(
          `Capability ${String(capability.id)} is not derived from its exact immutable manifest and probes.`,
        );
      }
      for (const probeId of probeIds) {
        const probe = object(probes[probeId], `${phaseName}.probes.${probeId}`);
        const parsedResult = object(
          probe.parsedResult,
          `${phaseName}.probes.${probeId}.parsedResult`,
        );
        if (
          !String(parsedResult.code ?? "").endsWith("-ok") ||
          (probe.type === "process" && probe.exitCode !== 0) ||
          (probe.type === "derived" && !SHA256_PATTERN.test(parsedResult.digest))
        ) {
          throw new Error(`Capability probe ${probeId} does not derive a successful result.`);
        }
      }
    }
    const expectedLifecycleResults =
      phaseName === "active"
        ? ["acquired", "promoted"]
        : phaseName === "rollback"
          ? ["rollback-authorized", "rolled-back"]
          : ["restored"];
    const lifecycle = object(phase.lifecycle, `${phaseName}.lifecycle`);
    const lifecycleResults = Array.isArray(lifecycle.receipts)
      ? lifecycle.receipts.map((entry) => entry?.result)
      : [];
    if (JSON.stringify(lifecycleResults) !== JSON.stringify(expectedLifecycleResults)) {
      throw new Error(`Capability proof ${phaseName} lifecycle sequence is incomplete.`);
    }
    const artifactsPassed = verifyCapabilityArtifact
      ? verifyCapabilityArtifact(phase)
      : verifyCapabilityObservationArtifacts(phase, {
          sourceSha,
          rollbackSha: expectedAuthorizationBindings.rollbackSha,
          activeReleaseId: expectedAuthorizationBindings.activeReleaseId,
          rollbackReleaseId: expectedAuthorizationBindings.rollbackReleaseId,
          authorizationBindings: expectedAuthorizationBindings,
        });
    if (!artifactsPassed) {
      throw new Error(`Capability proof ${phaseName} artifact digest verification failed.`);
    }
  }
  return proof;
}

function verifyCapabilityObservationArtifacts(phase, expected) {
  const verifyBinding = (binding, label) => {
    const value = object(binding, label);
    if (
      typeof value.path !== "string" ||
      !value.path ||
      !SHA256_PATTERN.test(value.sha256) ||
      !fs.existsSync(value.path) ||
      !fs.lstatSync(value.path).isFile() ||
      fs.lstatSync(value.path).isSymbolicLink() ||
      digest(value.path) !== value.sha256
    ) {
      throw new Error(`${label} failed exact file digest verification.`);
    }
  };
  phase.configuration.forEach((binding, index) =>
    verifyBinding(binding, `capability configuration ${index + 1}`),
  );
  for (const [name, binding] of Object.entries(phase.runtime)) {
    if (name !== "runtimeRootSha256") {
      verifyBinding(binding, `capability runtime ${name}`);
    }
  }
  verifyBinding(phase.lifecycle.lease, "capability lifecycle lease");
  const leaseSnapshot = object(
    JSON.parse(fs.readFileSync(phase.lifecycle.lease.path, "utf8")),
    "capability lifecycle lease snapshot",
  );
  const expectedState = phase.phase === "rollback" ? "rollback-drill" : "promoted";
  if (
    leaseSnapshot.activeSha !== expected.sourceSha ||
    leaseSnapshot.candidateSha !== expected.sourceSha ||
    leaseSnapshot.rollbackSha !== expected.rollbackSha ||
    leaseSnapshot.activeReleaseId !== expected.activeReleaseId ||
    leaseSnapshot.rollbackReleaseId !== expected.rollbackReleaseId ||
    leaseSnapshot.owner !== expected.authorizationBindings.leaseOwner ||
    leaseSnapshot.approvalId !== expected.authorizationBindings.approvalId ||
    leaseSnapshot.operationId !== expected.authorizationBindings.operationId ||
    leaseSnapshot.invocationId !== expected.authorizationBindings.invocationId ||
    leaseSnapshot.operationClass !== "release-certification" ||
    leaseSnapshot.state !== expectedState
  ) {
    throw new Error("Capability lifecycle lease snapshot has invalid exact bindings.");
  }
  phase.lifecycle.receipts.forEach((binding) => {
    verifyBinding(binding, `capability lifecycle ${String(binding.result)}`);
    const receipt = object(
      JSON.parse(fs.readFileSync(binding.path, "utf8")),
      `capability lifecycle ${String(binding.result)} receipt`,
    );
    const lease = object(
      receipt.lease,
      `capability lifecycle ${String(binding.result)} receipt lease`,
    );
    if (
      receipt.schema !== "openclaw.custom-runtime-certification-lease-receipt.v2" ||
      receipt.result !== binding.result ||
      receipt.activeSha !== expected.sourceSha ||
      receipt.candidateSha !== expected.sourceSha ||
      receipt.approvalId !== expected.authorizationBindings.approvalId ||
      receipt.operationId !== expected.authorizationBindings.operationId ||
      receipt.invocationId !== expected.authorizationBindings.invocationId ||
      lease.activeSha !== expected.sourceSha ||
      lease.candidateSha !== expected.sourceSha ||
      lease.rollbackSha !== expected.rollbackSha ||
      lease.activeReleaseId !== expected.activeReleaseId ||
      lease.rollbackReleaseId !== expected.rollbackReleaseId ||
      lease.owner !== expected.authorizationBindings.leaseOwner ||
      lease.approvalId !== expected.authorizationBindings.approvalId ||
      lease.operationId !== expected.authorizationBindings.operationId ||
      lease.invocationId !== expected.authorizationBindings.invocationId ||
      lease.operationClass !== "release-certification" ||
      (["rolled-back", "restored"].includes(binding.result) &&
        (!SHA256_PATTERN.test(receipt.transitionId) ||
          receipt.transitionId !== binding.transitionId))
    ) {
      throw new Error(
        `Capability lifecycle ${String(binding.result)} receipt has invalid exact bindings.`,
      );
    }
  });
  if (phase.lifecycle.restartReceipt) {
    verifyBinding(phase.lifecycle.restartReceipt, "capability restart receipt");
    const restart = object(
      JSON.parse(fs.readFileSync(phase.lifecycle.restartReceipt.path, "utf8")),
      "capability restart receipt",
    );
    const expectedReleaseId =
      phase.phase === "rollback" ? expected.rollbackReleaseId : expected.activeReleaseId;
    if (restart.result !== "restarted_verified" || restart.release !== expectedReleaseId) {
      throw new Error("Capability restart receipt has invalid exact release bindings.");
    }
  } else if (phase.phase !== "rollback") {
    throw new Error(`Capability ${String(phase.phase)} phase omits its restart receipt.`);
  }
  const artifactRoot = fs.realpathSync(phase.artifactRoot);
  const processCommandIds = {
    "immutable-runtime-contract": "managed-launcher-verify",
    "gateway-health": "gateway-health-rpc",
    "plugin-inventory": "managed-plugin-inventory",
    "pcc-summary": "pcc-summary-rpc",
    "operations-snapshot": "operations-snapshot-rpc",
    "sig-health": "self-improvement-health-rpc",
    "sig-production-check": "self-improvement-production-check-rpc",
    "tailscale-status": "tailscale-read-only-status",
    "tailscale-serve-status": "tailscale-read-only-serve-status",
  };
  const pluginIds = phase.capabilities
    .filter((capability) => String(capability.id).startsWith("plugin:"))
    .map((capability) => String(capability.id).slice("plugin:".length));
  for (const [probeId, probe] of Object.entries(phase.probes)) {
    if (probe.type === "derived") {
      continue;
    }
    if (probe.type === "process") {
      if (probe.commandId !== processCommandIds[probeId] || probe.exitCode !== 0) {
        throw new Error(`Capability process probe ${probeId} has invalid fixed execution data.`);
      }
      const paths = {};
      for (const stream of ["stdout", "stderr"]) {
        const binding = object(probe[stream], `${probeId}.${stream}`);
        const candidate = path.resolve(artifactRoot, binding.path);
        const realPath = fs.realpathSync(candidate);
        if (!realPath.startsWith(`${artifactRoot}${path.sep}`)) {
          throw new Error(`${probeId}.${stream} escapes the capability artifact root.`);
        }
        verifyBinding({ ...binding, path: realPath }, `${probeId}.${stream}`);
        paths[stream] = realPath;
      }
      const stdout = fs.readFileSync(paths.stdout, "utf8").trim();
      let derived = "";
      if (probeId === "immutable-runtime-contract") {
        derived =
          stdout === `CUSTOM_RUNTIME_OK sha=${phase.sourceSha} release=${phase.releaseId}`
            ? "immutable-runtime-contract-ok"
            : "";
      } else {
        const payload = object(JSON.parse(stdout), `${probeId} stdout`);
        if (!payload.error) {
          if (probeId === "tailscale-status") {
            derived = ["Running", "NeedsLogin"].includes(payload.BackendState)
              ? "tailscale-status-ok"
              : "";
          } else if (probeId === "plugin-inventory") {
            const plugins = Array.isArray(payload.plugins) ? payload.plugins : [];
            derived = pluginIds.every((pluginId) =>
              plugins.some(
                (plugin) =>
                  plugin?.id === pluginId &&
                  plugin?.enabled === true &&
                  !["error", "failed", "disabled"].includes(
                    String(plugin?.status ?? "").toLowerCase(),
                  ),
              ),
            )
              ? "plugin-inventory-ok"
              : "";
          } else {
            derived = `${probeId}-ok`;
          }
        }
      }
      if (!derived || probe.parsedResult?.code !== derived) {
        throw new Error(`Capability process probe ${probeId} transcript replay failed.`);
      }
      continue;
    }
    if (probe.type === "http") {
      const binding = object(probe.response, `${probeId}.response`);
      const candidate = fs.realpathSync(path.resolve(artifactRoot, binding.path));
      if (!candidate.startsWith(`${artifactRoot}${path.sep}`)) {
        throw new Error(`${probeId}.response escapes the capability artifact root.`);
      }
      verifyBinding({ ...binding, path: candidate }, `${probeId}.response`);
      const transcript = object(
        JSON.parse(fs.readFileSync(candidate, "utf8")),
        `${probeId} response transcript`,
      );
      const body = Buffer.from(String(transcript.bodyBase64 ?? ""), "base64").toString("utf8");
      let derived = "";
      if (probeId === "ollama-residency") {
        const payload = object(JSON.parse(body), "Ollama residency body");
        const models = Array.isArray(payload.models) ? payload.models : [];
        derived =
          transcript.status === 200 &&
          models.some(
            (model) =>
              (model?.name === phase.selectedModelId || model?.model === phase.selectedModelId) &&
              typeof model?.digest === "string" &&
              model.digest,
          )
            ? "ollama-residency-ok"
            : "";
      } else if (
        probeId.startsWith("dashboard-route:") &&
        transcript.status === 200 &&
        /<!doctype html|<html|openclaw/iu.test(body) &&
        !/unauthorized|forbidden/iu.test(body)
      ) {
        derived = `${probeId}-ok`;
      }
      if (!derived || probe.parsedResult?.code !== derived) {
        throw new Error(`Capability HTTP probe ${probeId} transcript replay failed.`);
      }
      continue;
    }
    throw new Error(`Capability probe ${probeId} has an unsupported runtime probe type.`);
  }
  return true;
}

function writePrivateTemporary(filePath, value) {
  const descriptor = fs.openSync(filePath, "w", 0o600);
  try {
    fs.writeFileSync(descriptor, value);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function fsyncDirectory(directoryPath) {
  const descriptor = fs.openSync(directoryPath, "r");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function writePrivateAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.tmp-${process.pid}`;
  writePrivateTemporary(temporary, value);
  fs.renameSync(temporary, filePath);
  fsyncDirectory(path.dirname(filePath));
}

export function buildControlDirectorFinalLedgerAuthority({
  sourceSha,
  checkedAt,
  manifestPath,
  manifestSha256,
  ledgerPath,
  ledgerSha256,
  projectionPath,
  projectionSha256,
}) {
  return {
    schema: "openclaw.control-director-final-ledger-authority.v1",
    sourceSha,
    checkedAt,
    generationManifest: { path: manifestPath, sha256: manifestSha256 },
    ledger: { path: ledgerPath, sha256: ledgerSha256 },
    certifiedProjection: { path: projectionPath, sha256: projectionSha256 },
    committed: true,
  };
}

function resolveAuthorityGenerationArtifact(repoRoot, binding, label) {
  const artifact = object(binding, label);
  requiredString(artifact.path, `${label}.path`);
  if (!SHA256_PATTERN.test(String(artifact.sha256 ?? ""))) {
    throw new Error(`${label}.sha256 must be a lowercase SHA-256 digest.`);
  }
  const artifactPath = path.resolve(repoRoot, artifact.path);
  const relative = path.relative(repoRoot, artifactPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label}.path must remain inside the source checkout.`);
  }
  if (!fs.existsSync(artifactPath) || !fs.statSync(artifactPath).isFile()) {
    throw new Error(`${label}.path does not identify a regular file.`);
  }
  if (digest(artifactPath) !== artifact.sha256) {
    throw new Error(`${label} digest verification failed.`);
  }
  return artifactPath;
}

function verifyFinalLedgerAuthorityArtifacts(repoRoot, authorityPath) {
  const authority = readJson(authorityPath);
  if (
    authority.schema !== "openclaw.control-director-final-ledger-authority.v1" ||
    authority.committed !== true ||
    !SHA_PATTERN.test(String(authority.sourceSha ?? "")) ||
    !validDate(authority.checkedAt)
  ) {
    throw new Error("Final-ledger authority pointer is not a committed exact-source v1 pointer.");
  }
  const manifestPath = resolveAuthorityGenerationArtifact(
    repoRoot,
    authority.generationManifest,
    "authority.generationManifest",
  );
  const ledgerPath = resolveAuthorityGenerationArtifact(
    repoRoot,
    authority.ledger,
    "authority.ledger",
  );
  const projectionPath = resolveAuthorityGenerationArtifact(
    repoRoot,
    authority.certifiedProjection,
    "authority.certifiedProjection",
  );
  const manifest = readJson(manifestPath);
  if (
    manifest.schema !== "openclaw.control-director-final-ledger-generation.v1" ||
    manifest.sourceSha !== authority.sourceSha ||
    manifest.checkedAt !== authority.checkedAt ||
    manifest.ledger.path !== authority.ledger.path ||
    manifest.ledger.sha256 !== authority.ledger.sha256 ||
    manifest.certifiedProjection.path !== authority.certifiedProjection.path ||
    manifest.certifiedProjection.sha256 !== authority.certifiedProjection.sha256
  ) {
    throw new Error("Final-ledger generation manifest does not match its authority pointer.");
  }
  return {
    authority,
    manifest,
    ledger: readJson(ledgerPath),
    certifiedProjection: readJson(projectionPath),
    ledgerPath,
  };
}

function verifiedLedgerArtifact(artifacts, name) {
  const binding = object(artifacts[name], `ledger.artifacts.${name}`);
  requiredString(binding.path, `ledger.artifacts.${name}.path`);
  if (!SHA256_PATTERN.test(String(binding.sha256 ?? ""))) {
    throw new Error(`ledger.artifacts.${name}.sha256 must be a lowercase SHA-256 digest.`);
  }
  const artifactPath = path.resolve(binding.path);
  if (!fs.existsSync(artifactPath) || !fs.statSync(artifactPath).isFile()) {
    throw new Error(`ledger.artifacts.${name}.path does not identify a regular file.`);
  }
  if (digest(artifactPath) !== binding.sha256) {
    throw new Error(`ledger.artifacts.${name} digest verification failed.`);
  }
  return {
    path: artifactPath,
    value:
      name === "judgePublicKey" || name === "campaignJudgePublicKey"
        ? fs.readFileSync(artifactPath, "utf8")
        : readJson(artifactPath),
  };
}

function verifyControlDirectorFinalLedgerSemantics({
  repoRoot,
  ledgerPath,
  ledger,
  certifiedProjection,
  expected,
}) {
  if (
    ledger.schema !== "openclaw.control-director-final-ledger.v3" ||
    ledger.sourceSha !== expected.sourceSha ||
    ledger.executionPlatform !== "mac-studio" ||
    ledger.remoteExecutionRequired !== false ||
    ledger.passed !== true ||
    !validDate(ledger.checkedAt)
  ) {
    throw new Error("Final ledger is not an exact-source passing Mac Studio v3 ledger.");
  }
  const authorizationBindings = object(
    ledger.authorizationBindings,
    "ledger.authorizationBindings",
  );
  if (!isDeepStrictEqual(authorizationBindings, expected.authorizationBindings)) {
    throw new Error("Final ledger authorization bindings do not match the expected identities.");
  }
  if (
    !isDeepStrictEqual(ledger.ownerAcceptance, {
      required: true,
      owner: "Matthew",
      status: "pending",
      recordedAt: null,
    })
  ) {
    throw new Error("Final ledger owner acceptance must remain a pending human-only gate.");
  }
  const artifacts = object(ledger.artifacts, "ledger.artifacts");
  const expectedArtifactNames = [
    "roadmap",
    "judgePublicKey",
    "campaignJudgePublicKey",
    ...REQUIRED_BINDINGS,
  ];
  if (
    JSON.stringify(Object.keys(artifacts).toSorted()) !==
    JSON.stringify(expectedArtifactNames.toSorted())
  ) {
    throw new Error("Final ledger does not contain the exact required artifact set.");
  }
  const reopened = Object.fromEntries(
    expectedArtifactNames.map((name) => [name, verifiedLedgerArtifact(artifacts, name)]),
  );
  const roadmapPath = reopened.roadmap.path;
  if (!controlDirectorRoadmapPathMatchesCanonical(roadmapPath, repoRoot)) {
    throw new Error(`Final ledger roadmap must be the canonical ${CANONICAL_ROADMAP_PATH}.`);
  }
  if (!controlDirectorSourceProofMatchesRoot(reopened.sourceProof.value.sourceRoot, repoRoot)) {
    throw new Error("Final ledger source proof does not match the current repository root.");
  }
  const judgePublicKeyPath = path.join(
    resolveStateDir(),
    "credentials",
    "judge-receipt-ed25519-public.pem",
  );
  if (reopened.judgePublicKey.path !== judgePublicKeyPath) {
    throw new Error("Final ledger Judge key is not the managed trust root.");
  }
  const judgePublicKeyPem = fs.readFileSync(judgePublicKeyPath, "utf8");
  const judgePublicKeyId = createHash("sha256")
    .update(createPublicKey(judgePublicKeyPem).export({ type: "spki", format: "der" }))
    .digest("hex");
  if (judgePublicKeyId !== authorizationBindings.expectedJudgePublicKeyId) {
    throw new Error("Final ledger Judge key identity does not match the managed trust root.");
  }
  const campaignJudgePublicKeyPath = path.join(
    resolveStateDir(),
    "credentials",
    "judge-campaign-receipt-ed25519-public.pem",
  );
  if (reopened.campaignJudgePublicKey.path !== campaignJudgePublicKeyPath) {
    throw new Error("Final ledger campaign Judge key is not the managed trust root.");
  }
  const campaignJudgePublicKeyPem = fs.readFileSync(campaignJudgePublicKeyPath, "utf8");
  const campaignJudgePublicKeyId = createHash("sha256")
    .update(createPublicKey(campaignJudgePublicKeyPem).export({ type: "spki", format: "der" }))
    .digest("hex");
  if (
    campaignJudgePublicKeyId !== authorizationBindings.expectedCampaignJudgePublicKeyId ||
    campaignJudgePublicKeyId === judgePublicKeyId
  ) {
    throw new Error(
      "Final ledger campaign Judge key identity does not match the distinct authorized trust root.",
    );
  }
  const capabilityManifest = readJson(
    path.join(repoRoot, "config/custom-runtime-capabilities.json"),
  );
  const milestoneAudit = auditControlDirectorMilestones({
    rootDir: repoRoot,
    roadmapPath: CANONICAL_ROADMAP_PATH,
  });
  const expectedProjection = buildCertifiedControlDirectorRoadmapProjection({
    roadmap: reopened.roadmap.value,
    milestoneAudit,
    finalReceiptPath: path.relative(repoRoot, ledgerPath),
    finalReceiptSha256: digest(ledgerPath),
  });
  if (!isDeepStrictEqual(certifiedProjection, expectedProjection)) {
    throw new Error(
      "Certified roadmap projection is not derived from the tracked roadmap and current implementation audit.",
    );
  }
  const validation = validateControlDirectorRoadmap({
    roadmap: certifiedProjection,
    sourceSha: expected.sourceSha,
    expectedModel: authorizationBindings.expectedModel,
    expectedConfigDigest: authorizationBindings.expectedConfigDigest,
    expectedSecondaryConfigDigest: authorizationBindings.expectedSecondaryConfigDigest,
    expectedRollbackSha: authorizationBindings.expectedRollbackSha,
    expectedActiveReleaseId: authorizationBindings.expectedActiveReleaseId,
    expectedRollbackReleaseId: authorizationBindings.expectedRollbackReleaseId,
    expectedLeaseOwner: authorizationBindings.expectedLeaseOwner,
    expectedApprovalId: authorizationBindings.expectedApprovalId,
    expectedOperationId: authorizationBindings.expectedOperationId,
    expectedInvocationId: authorizationBindings.expectedInvocationId,
    capabilityManifest,
    judgePublicKeyPem,
    expectedJudgePublicKeyId: judgePublicKeyId,
    campaignJudgePublicKeyPem,
    expectedCampaignJudgePublicKeyId: campaignJudgePublicKeyId,
    readRuntimeSoakArtifact: (bindingValue) => readContainedArtifact(repoRoot, bindingValue),
    verifyStabilityArtifact: (bindingValue) => {
      const candidate = path.resolve(repoRoot, bindingValue.path);
      const relative = path.relative(repoRoot, candidate);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        return false;
      }
      try {
        return (
          fs.statSync(candidate).isFile() &&
          digest(candidate) === bindingValue.sha256 &&
          isDeepStrictEqual(readJson(candidate), bindingValue.receipt)
        );
      } catch {
        return false;
      }
    },
    verifyModelEvalArtifact: (artifact) => {
      const candidate = path.resolve(repoRoot, artifact.path);
      const relative = path.relative(repoRoot, candidate);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        return false;
      }
      try {
        return fs.statSync(candidate).isFile() && digest(candidate) === artifact.sha256;
      } catch {
        return false;
      }
    },
    requireProjectionContract: true,
    finalReceiptPath: path.relative(repoRoot, ledgerPath),
    finalReceiptSha256: digest(ledgerPath),
    ...Object.fromEntries(REQUIRED_BINDINGS.map((name) => [name, reopened[name].value])),
  });
  for (const [name, value] of Object.entries(validation)) {
    if (!isDeepStrictEqual(ledger[name], value)) {
      throw new Error(`Final ledger semantic field ${name} is not independently derived.`);
    }
  }
  return validation;
}

export function verifyControlDirectorFinalLedgerAuthority({
  repoRoot,
  authorityPath,
  expected,
  semanticVerifier = verifyControlDirectorFinalLedgerSemantics,
}) {
  const sourceRoot = path.resolve(repoRoot);
  const pointerPath = path.resolve(authorityPath);
  const pointerRelative = path.relative(sourceRoot, pointerPath);
  if (pointerRelative.startsWith("..") || path.isAbsolute(pointerRelative)) {
    throw new Error("Final-ledger authority pointer must remain inside the source checkout.");
  }
  const generation = verifyFinalLedgerAuthorityArtifacts(sourceRoot, pointerPath);
  if (generation.authority.sourceSha !== expected.sourceSha) {
    throw new Error("Final-ledger authority source SHA does not match the expected source SHA.");
  }
  if (
    generation.authority.checkedAt !== generation.ledger.checkedAt ||
    generation.manifest.checkedAt !== generation.ledger.checkedAt
  ) {
    throw new Error("Final-ledger generation timestamps do not agree.");
  }
  const authorizationBindings = object(
    generation.ledger.authorizationBindings,
    "ledger.authorizationBindings",
  );
  if (!isDeepStrictEqual(authorizationBindings, expected.authorizationBindings)) {
    throw new Error("Final-ledger authority does not bind the expected authorization identities.");
  }
  const validation = semanticVerifier({
    repoRoot: sourceRoot,
    ledgerPath: generation.ledgerPath,
    ledger: generation.ledger,
    certifiedProjection: generation.certifiedProjection,
    expected,
  });
  return {
    sourceSha: generation.authority.sourceSha,
    checkedAt: generation.authority.checkedAt,
    ledgerSha256: generation.authority.ledger.sha256,
    projectionSha256: generation.authority.certifiedProjection.sha256,
    validation,
  };
}

export function validateControlDirectorRoadmap(params) {
  const roadmap = object(params.roadmap, "roadmap");
  const sourceSha = immutableSha(params.sourceSha, "sourceSha");
  const expectedModel =
    typeof params.expectedModel === "string" && params.expectedModel.trim()
      ? params.expectedModel.trim()
      : undefined;
  const expectedConfigDigest =
    typeof params.expectedConfigDigest === "string" &&
    SHA256_PATTERN.test(params.expectedConfigDigest)
      ? params.expectedConfigDigest
      : undefined;
  const expectedSecondaryConfigDigest =
    typeof params.expectedSecondaryConfigDigest === "string" &&
    SHA256_PATTERN.test(params.expectedSecondaryConfigDigest)
      ? params.expectedSecondaryConfigDigest
      : undefined;
  const expectedRollbackSha =
    typeof params.expectedRollbackSha === "string" && SHA_PATTERN.test(params.expectedRollbackSha)
      ? params.expectedRollbackSha
      : undefined;
  const expectedActiveReleaseId = params.expectedActiveReleaseId;
  const expectedRollbackReleaseId = params.expectedRollbackReleaseId;
  const expectedLeaseOwner = params.expectedLeaseOwner;
  const expectedApprovalId = params.expectedApprovalId;
  const expectedOperationId = params.expectedOperationId;
  const expectedInvocationId = params.expectedInvocationId;
  const progress = summarizeControlDirectorProgress(roadmap);
  const completionPolicy = object(roadmap.completionPolicy, "completionPolicy");
  if (
    completionPolicy.requireAllMilestones !== true ||
    completionPolicy.allowPartialCompletionClaim !== false ||
    completionPolicy.executionPlatform !== "mac-studio" ||
    completionPolicy.remoteExecutionRequired !== false ||
    completionPolicy.remoteExecutionPolicy !== "not-a-certification-surface" ||
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
  const forbiddenTruthSurfaces = [
    "remote-ci",
    "dashboard-desktop",
    "dashboard-tablet",
    "dashboard-mobile",
  ].filter((surface) => truthSurfaces.includes(surface));
  if (forbiddenTruthSurfaces.length > 0) {
    throw new Error(
      `Roadmap retains superseded proof surfaces: ${forbiddenTruthSurfaces.join(", ")}.`,
    );
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
  if (params.requireProjectionContract === true) {
    validateProjectionContract(roadmap, params.finalReceiptPath, params.finalReceiptSha256);
  }
  const milestones = Array.isArray(roadmap.milestones)
    ? roadmap.milestones.map((entry) => object(entry, "milestone"))
    : [];
  const byId = new Map(milestones.map((milestone) => [milestone.id, milestone]));
  for (const milestone of milestones) {
    const { certificationStatus, implementationStatus } = milestoneProgress(milestone);
    if (implementationStatus !== "implemented") {
      throw new Error(`${milestone.id} is not implemented.`);
    }
    if (certificationStatus !== "passed") {
      throw new Error(`${milestone.id} is not passed.`);
    }
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
    if (
      evidence.some((entry) => entry.startsWith("runtime:")) &&
      !evidence.includes("binding:runtimeProof")
    ) {
      throw new Error(`${milestone.id} runtime evidence is not bound to runtimeProof.`);
    }
    const dependencies = Array.isArray(milestone.dependsOn) ? milestone.dependsOn : [];
    for (const dependency of dependencies) {
      if (milestoneProgress(byId.get(dependency)).certificationStatus !== "passed") {
        throw new Error(`${milestone.id} dependency ${String(dependency)} is not passed.`);
      }
    }
    for (const requiredBinding of REQUIRED_MILESTONE_BINDINGS[milestone.id] ?? []) {
      if (!evidence.includes(`binding:${requiredBinding}`)) {
        throw new Error(`${milestone.id} is not bound to ${requiredBinding}.`);
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
    sourceProof.passed !== true ||
    !validDate(sourceProof.generatedAt) ||
    !validDate(sourceProof.completedAt) ||
    Date.parse(sourceProof.completedAt) < Date.parse(sourceProof.generatedAt)
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
  const sourceCommandIds = new Set(
    commands.map((entry) => object(entry, "source command").id).filter(Boolean),
  );
  const missingSourceCommands = REQUIRED_SOURCE_COMMANDS.filter(
    (command) => !sourceCommandIds.has(command),
  );
  if (missingSourceCommands.length > 0) {
    throw new Error(
      `Source proof command ledger omits required gates: ${missingSourceCommands.join(", ")}.`,
    );
  }

  const updateSurvival = object(params.updateSurvival, "updateSurvival");
  exactSha(updateSurvival.sourceSha, sourceSha, "updateSurvival");
  if (
    updateSurvival.schema !== "openclaw.custom-runtime-update-survival.v1" ||
    updateSurvival.mode !== "source-contract" ||
    updateSurvival.sourceClean !== true ||
    updateSurvival.contractVersion !== 2 ||
    updateSurvival.sourceStrategy !== "merge_from_active_sha" ||
    updateSurvival.dashboardChangePolicy !== "register_verify_and_block" ||
    updateSurvival.approvalPolicy !== "explicit_exact_candidate" ||
    updateSurvival.proofCommand !== "pnpm custom-runtime:update-survival" ||
    !Number.isInteger(updateSurvival.manifestVersion) ||
    updateSurvival.manifestVersion < 5 ||
    updateSurvival.passed !== true ||
    !validDate(updateSurvival.checkedAt) ||
    !/^[a-f0-9]{64}$/u.test(String(updateSurvival.manifestSha256 ?? "")) ||
    nonEmptyStrings(updateSurvival.evidenceRefs).length === 0 ||
    JSON.stringify(updateSurvival.verificationCommands) !== JSON.stringify(UPDATE_SURVIVAL_COMMANDS)
  ) {
    throw new Error("Update-survival proof is not a clean exact-source v1 pass.");
  }
  const updateFacts = Array.isArray(updateSurvival.facts) ? updateSurvival.facts : [];
  if (
    updateFacts.length === 0 ||
    updateFacts.some((entry) => object(entry, "update-survival fact").passed !== true)
  ) {
    throw new Error("Update-survival proof does not contain an all-passed fact ledger.");
  }
  const updateFactIds = new Set(
    updateFacts.map((entry) => object(entry, "update-survival fact").id).filter(Boolean),
  );
  const missingUpdateFacts = REQUIRED_UPDATE_SURVIVAL_FACTS.filter(
    (factId) => !updateFactIds.has(factId),
  );
  if (missingUpdateFacts.length > 0) {
    throw new Error(
      `Update-survival proof omits required facts: ${missingUpdateFacts.join(", ")}.`,
    );
  }
  const runtimeProof = object(params.runtimeProof, "runtimeProof");
  exactSha(runtimeProof.sourceSha, sourceSha, "runtimeProof");
  if (runtimeProof.schemaVersion !== 4 || runtimeProof.sigBackgroundEnabled !== true) {
    throw new Error("Runtime proof is not the Mac Studio managed SIG-enabled v4 contract.");
  }
  if (!validDate(runtimeProof.generatedAt)) {
    throw new Error("Runtime proof has no valid generatedAt timestamp.");
  }
  const runtimeGeneratedAt = Date.parse(runtimeProof.generatedAt);
  const lineage = object(runtimeProof.lineage, "runtimeProof.lineage");
  exactSha(lineage.sourceSha, sourceSha, "runtimeProof.lineage");
  const canary = object(lineage.canary, "runtimeProof.lineage.canary");
  exactSha(canary.sourceSha, sourceSha, "runtimeProof.lineage.canary");
  if (
    lineage.status !== "ready" ||
    typeof lineage.selectedModel !== "string" ||
    !lineage.selectedModel.trim() ||
    !/^[a-f0-9]{64}$/u.test(String(lineage.artifactHash ?? "")) ||
    !validDate(lineage.checkedAt) ||
    Date.parse(lineage.checkedAt) > runtimeGeneratedAt ||
    nonEmptyStrings(lineage.evidenceRefs).length === 0 ||
    canary.uiBuildId !== lineage.artifactHash
  ) {
    throw new Error("Runtime lineage is not a ready exact-build canary pass.");
  }
  if (expectedModel && lineage.selectedModel !== expectedModel) {
    throw new Error("Runtime lineage selected model does not match the authorized model.");
  }
  const runtimeArtifacts = object(runtimeProof.artifacts, "runtimeProof.artifacts");
  const lineageArtifact = object(runtimeArtifacts.lineage, "runtimeProof.artifacts.lineage");
  if (!/^[a-f0-9]{64}$/u.test(String(lineageArtifact.sha256 ?? ""))) {
    throw new Error("Runtime lineage artifact is not digest-bound.");
  }
  const judgePublicKeyArtifact = object(
    runtimeArtifacts.judgePublicKey,
    "runtimeProof.artifacts.judgePublicKey",
  );
  if (
    typeof params.judgePublicKeyPem !== "string" ||
    !params.judgePublicKeyPem.includes("PUBLIC KEY") ||
    judgePublicKeyArtifact.sha256 !== digestText(params.judgePublicKeyPem)
  ) {
    throw new Error("Runtime Judge public key artifact does not match the trusted key bytes.");
  }
  const campaignJudgePublicKeyArtifact = object(
    runtimeArtifacts.campaignJudgePublicKey,
    "runtimeProof.artifacts.campaignJudgePublicKey",
  );
  const campaignJudgePublicKeyPem =
    typeof params.campaignJudgePublicKeyPem === "string"
      ? params.campaignJudgePublicKeyPem
      : fs.readFileSync(
          requiredString(
            campaignJudgePublicKeyArtifact.path,
            "runtimeProof.artifacts.campaignJudgePublicKey.path",
          ),
          "utf8",
        );
  const campaignJudgePublicKeyId = createHash("sha256")
    .update(createPublicKey(campaignJudgePublicKeyPem).export({ type: "spki", format: "der" }))
    .digest("hex");
  if (
    !SHA256_PATTERN.test(String(params.expectedCampaignJudgePublicKeyId ?? "")) ||
    !campaignJudgePublicKeyPem.includes("PUBLIC KEY") ||
    campaignJudgePublicKeyArtifact.sha256 !== digestText(campaignJudgePublicKeyPem) ||
    campaignJudgePublicKeyId !== params.expectedCampaignJudgePublicKeyId ||
    campaignJudgePublicKeyId === params.expectedJudgePublicKeyId
  ) {
    throw new Error(
      "Runtime campaign Judge public key artifact is not a distinct trusted key binding.",
    );
  }
  const runtimeEvidence = new Map();
  for (const surface of RUNTIME_SURFACES) {
    const evidence = validateRuntimeSurface(surface, runtimeProof[surface], sourceSha);
    if (Date.parse(evidence.checkedAt) > runtimeGeneratedAt) {
      throw new Error(`Runtime surface ${surface} cannot postdate runtimeProof.generatedAt.`);
    }
    runtimeEvidence.set(surface, evidence);
  }
  const modelEval = object(runtimeProof.modelEval, "runtimeProof.modelEval");
  exactSha(modelEval.sourceSha, sourceSha, "runtimeProof.modelEval");
  if (
    modelEval.schemaVersion !== 1 ||
    !validDate(modelEval.evaluatedAt) ||
    Date.parse(modelEval.evaluatedAt) > runtimeGeneratedAt ||
    modelEval.passed !== true ||
    modelEval.exactRuntime !== true ||
    modelEval.passRate !== 100 ||
    modelEval.criticalOmissions !== 0 ||
    modelEval.coveragePassed !== true
  ) {
    throw new Error("Runtime model evaluation is not a 100% exact-runtime pass.");
  }
  const suppliedModelResults = Array.isArray(modelEval.results) ? modelEval.results : [];
  const modelEvalIdentity = object(modelEval.modelIdentity, "runtimeProof.modelEval.modelIdentity");
  const selectedModelIdentity = {
    modelDigest: requiredString(
      modelEvalIdentity.modelDigest,
      "runtimeProof.modelEval.modelIdentity.modelDigest",
    ),
    cacheDigest: requiredString(
      modelEvalIdentity.cacheDigest,
      "runtimeProof.modelEval.modelIdentity.cacheDigest",
    ),
  };
  if (
    !SHA256_PATTERN.test(selectedModelIdentity.modelDigest) ||
    !SHA256_PATTERN.test(selectedModelIdentity.cacheDigest)
  ) {
    throw new Error("Runtime model evaluation does not bind immutable model and cache digests.");
  }
  const parsedModelTrials = parseControlDirectorModelEvalTrials(
    suppliedModelResults.map(
      (entry, index) => object(entry, `runtimeProof.modelEval.results[${index}]`).trial,
    ),
  );
  if (typeof params.verifyModelEvalArtifact !== "function") {
    throw new Error("Runtime model evaluation requires an independent artifact verifier.");
  }
  const runtimeCertification = object(runtimeProof.certification, "runtimeProof.certification");
  const campaignConfigDigest = requiredString(
    runtimeCertification.configurationDigest,
    "runtimeProof.certification.configurationDigest",
  );
  const campaignRollbackSha = immutableSha(
    runtimeCertification.rollbackSha,
    "runtimeProof.certification.rollbackSha",
  );
  if (expectedConfigDigest && campaignConfigDigest !== expectedConfigDigest) {
    throw new Error("runtime receipt configuration digest does not match the authorization.");
  }
  if (expectedRollbackSha && campaignRollbackSha !== expectedRollbackSha) {
    throw new Error("Runtime proof does not bind the exact monitoring and lifecycle receipts.");
  }
  if (
    runtimeCertification.activeReleaseId !== expectedActiveReleaseId ||
    runtimeCertification.rollbackReleaseId !== expectedRollbackReleaseId ||
    runtimeCertification.leaseOwner !== expectedLeaseOwner ||
    runtimeCertification.approvalId !== expectedApprovalId ||
    runtimeCertification.operationId !== expectedOperationId ||
    runtimeCertification.invocationId !== expectedInvocationId ||
    runtimeCertification.judgePublicKeyId !== params.expectedJudgePublicKeyId ||
    runtimeCertification.campaignJudgePublicKeyId !== params.expectedCampaignJudgePublicKeyId ||
    typeof runtimeCertification.runtimeHome !== "string" ||
    !path.isAbsolute(runtimeCertification.runtimeHome)
  ) {
    throw new Error("Runtime certification identities do not match the exact authorization.");
  }
  if (typeof params.readRuntimeSoakArtifact !== "function") {
    throw new Error("Runtime soak requires a digest-bound artifact reader.");
  }
  const verifiedRuntimeSoak = verifyControlDirectorRuntimeSoak({
    evidence: object(runtimeProof.soak, "runtimeProof.soak"),
    expected: {
      sourceSha,
      activeReleaseId: expectedActiveReleaseId,
      configurationDigest: campaignConfigDigest,
      selectedModel: String(lineage.selectedModel),
      invocationId: expectedInvocationId,
      notBefore: requiredString(
        runtimeCertification.leaseAcquiredAt,
        "runtimeProof.certification.leaseAcquiredAt",
      ),
      notAfter: requiredString(runtimeProof.generatedAt, "runtimeProof.generatedAt"),
    },
    readArtifact: params.readRuntimeSoakArtifact,
    verifyCapabilityObservation:
      params.verifyRuntimeSoakCapabilityObservation ??
      params.verifyStabilityCapabilityObservation ??
      verifyControlDirectorCapabilityObservation,
  });
  if (!isDeepStrictEqual(verifiedRuntimeSoak, runtimeProof.soak)) {
    throw new Error("Runtime soak projection does not match its replayed exact-runtime evidence.");
  }
  const recomputedModelEval = buildControlDirectorModelEvalMatrix({
    trials: parsedModelTrials,
    sourceSha,
    configurationDigest: expectedConfigDigest,
    modelRef: String(lineage.selectedModel),
    modelIdentity: selectedModelIdentity,
    evaluatedAt: String(modelEval.evaluatedAt),
    verifyArtifact: params.verifyModelEvalArtifact,
    certification: {
      activeReleaseId: expectedActiveReleaseId,
      rollbackReleaseId: expectedRollbackReleaseId,
      leaseOwner: expectedLeaseOwner,
      approvalId: expectedApprovalId,
      operationId: expectedOperationId,
      invocationId: expectedInvocationId,
      judgeAgentId: requiredString(
        runtimeCertification.judgeAgentId,
        "runtimeProof.certification.judgeAgentId",
      ),
      judgePublicKeyPem: params.judgePublicKeyPem,
      judgePublicKeyId: params.expectedJudgePublicKeyId,
      leaseAcquiredAt: requiredString(
        runtimeCertification.leaseAcquiredAt,
        "runtimeProof.certification.leaseAcquiredAt",
      ),
    },
  });
  if (
    !recomputedModelEval.passed ||
    recomputedModelEval.results.length < 48 ||
    recomputedModelEval.trialReceiptSetDigest !== modelEval.trialReceiptSetDigest ||
    recomputedModelEval.results.some((result) => !result.provenanceVerified)
  ) {
    throw new Error(
      `Runtime model evaluation is not backed by verified exact-runtime trial receipts: passed=${recomputedModelEval.passed}, trials=${recomputedModelEval.results.length}, receiptSet=${recomputedModelEval.trialReceiptSetDigest === modelEval.trialReceiptSetDigest}, unverified=${recomputedModelEval.results.filter((result) => !result.provenanceVerified).length}, firstBlockers=${JSON.stringify(recomputedModelEval.results[0]?.blockers ?? [])}.`,
    );
  }
  const modelResults = recomputedModelEval.results;
  const seenTrials = new Set();
  const coverage = new Set();
  const qualityScores = modelResults.map((entry) => {
    const result = object(entry, "model result");
    const quality = object(result.quality, "model quality");
    const trial = object(result.trial, "model trial");
    if (
      result.passed !== true ||
      result.resourcePassed !== true ||
      nonEmptyStrings(result.blockers).length !== 0
    ) {
      throw new Error("At least one model-evaluation result is not an unblocked pass.");
    }
    if (
      typeof trial.trialId !== "string" ||
      !trial.trialId.trim() ||
      seenTrials.has(trial.trialId)
    ) {
      throw new Error("Model-evaluation trial identities must be unique and non-empty.");
    }
    seenTrials.add(trial.trialId);
    if (
      !MODEL_EVAL_TASK_CLASSES.includes(trial.taskClass) ||
      typeof trial.cold !== "boolean" ||
      trial.modelRef !== lineage.selectedModel ||
      trial.route !== "local" ||
      nonEmptyStrings(trial.evidenceRefs).length === 0
    ) {
      throw new Error(
        "A model-evaluation trial is not exact-route evidence for the selected model.",
      );
    }
    coverage.add(`${trial.taskClass}:${trial.cold ? "cold" : "warm"}`);
    return Number(quality.score);
  });
  const missingCoverage = MODEL_EVAL_TASK_CLASSES.flatMap((taskClass) =>
    ["cold", "warm"].filter((temperature) => !coverage.has(`${taskClass}:${temperature}`)),
  );
  if (missingCoverage.length > 0) {
    throw new Error("Runtime model evaluation is missing required cold or warm task coverage.");
  }
  if (
    qualityScores.length < 48 ||
    qualityScores.some(
      (score) => !Number.isFinite(score) || score < Number(completionPolicy.requiredQualityScore),
    )
  ) {
    throw new Error("At least one model-evaluation quality score is below the roadmap minimum.");
  }

  const localValidationProof = object(params.localValidationProof, "localValidationProof");
  exactSha(localValidationProof.sourceSha, sourceSha, "localValidationProof");
  if (
    localValidationProof.schema !== "openclaw.control-director-mac-studio-local-validation.v1" ||
    localValidationProof.platform !== "mac-studio" ||
    localValidationProof.remoteExecutionRequired !== false ||
    localValidationProof.passed !== true ||
    !validDate(localValidationProof.generatedAt) ||
    nonEmptyStrings(localValidationProof.evidenceRefs).length === 0
  ) {
    throw new Error(
      "Mac Studio local validation proof is not a timestamped evidence-backed v1 pass.",
    );
  }
  const localValidationGeneratedAt = Date.parse(localValidationProof.generatedAt);
  const localHost = object(localValidationProof.host, "localValidationProof.host");
  if (
    localHost.hardwareClass !== "Mac Studio" ||
    localHost.osName !== "macOS" ||
    localHost.architecture !== "arm64" ||
    !SHA256_PATTERN.test(String(localHost.hostIdentitySha256 ?? ""))
  ) {
    throw new Error(
      "localValidationProof.host must bind a privacy-safe arm64 Mac Studio identity.",
    );
  }
  requiredString(localHost.osVersion, "localValidationProof.host.osVersion");
  const runtimeHost = object(
    object(runtimeProof.macStudioDashboard, "runtimeProof.macStudioDashboard").host,
    "runtimeProof.macStudioDashboard.host",
  );
  if (
    localHost.hostIdentitySha256 !== runtimeHost.hostIdentitySha256 ||
    localHost.hardwareClass !== runtimeHost.hardwareClass ||
    localHost.osName !== runtimeHost.osName ||
    localHost.osVersion !== runtimeHost.osVersion ||
    localHost.architecture !== runtimeHost.architecture
  ) {
    throw new Error(
      "Mac Studio local validation and managed-runtime proofs bind different host identities.",
    );
  }
  const localGates = Array.isArray(localValidationProof.gates)
    ? localValidationProof.gates.map((entry) => object(entry, "local validation gate"))
    : [];
  const localGateIds = new Set(localGates.map((gate) => gate.id));
  if (
    localGates.length !== REQUIRED_LOCAL_VALIDATION_GATES.length ||
    localGateIds.size !== localGates.length ||
    REQUIRED_LOCAL_VALIDATION_GATES.some((gate) => !localGateIds.has(gate)) ||
    localGates.some((gate) => {
      exactSha(gate.sourceSha, sourceSha, `localValidationProof.${String(gate.id)}`);
      return (
        gate.execution !== "mac-studio-local" ||
        gate.status !== "passed" ||
        !validDate(gate.checkedAt) ||
        Date.parse(gate.checkedAt) > localValidationGeneratedAt ||
        nonEmptyStrings(gate.evidenceRefs).length === 0 ||
        typeof gate.command !== "string" ||
        !gate.command.trim()
      );
    })
  ) {
    throw new Error(
      "Mac Studio local validation does not contain every exact-SHA all-passed local gate.",
    );
  }
  const landing = object(localValidationProof.landing, "localValidationProof.landing");
  if (
    landing.merged !== true ||
    landing.mergeSha !== sourceSha ||
    !Number.isInteger(landing.pullRequest) ||
    landing.pullRequest <= 0 ||
    !validDate(landing.mergedAt) ||
    Date.parse(landing.mergedAt) > localValidationGeneratedAt ||
    nonEmptyStrings(landing.evidenceRefs).length === 0
  ) {
    throw new Error("Landing does not bind the exact locally validated source SHA.");
  }
  const landingAt = Date.parse(landing.mergedAt);
  if (
    Date.parse(sourceProof.completedAt) > localValidationGeneratedAt ||
    Date.parse(updateSurvival.checkedAt) > localValidationGeneratedAt
  ) {
    throw new Error("Exact-source proof must complete before the local validation bundle.");
  }
  if (
    runtimeGeneratedAt < landingAt ||
    Date.parse(lineage.checkedAt) < landingAt ||
    Date.parse(modelEval.evaluatedAt) < landingAt ||
    [...runtimeEvidence.values()].some((evidence) => Date.parse(evidence.checkedAt) < landingAt)
  ) {
    throw new Error("Managed-runtime proof must be measured after exact-SHA landing.");
  }

  const readiness = object(params.readiness, "readiness");
  exactSha(readiness.sourceSha, sourceSha, "readiness");
  if (expectedConfigDigest && readiness.configurationDigest !== expectedConfigDigest) {
    throw new Error("Production readiness does not match the authorized configuration digest.");
  }
  if (
    readiness.schemaVersion !== 2 ||
    !validDate(readiness.generatedAt) ||
    Date.parse(readiness.generatedAt) < runtimeGeneratedAt ||
    readiness.expectedSha !== sourceSha ||
    readiness.sourceReady !== true ||
    readiness.productionReady !== true ||
    readiness.passPercent !== 100 ||
    readiness.mode !== "production" ||
    readiness.selectedModel !== lineage.selectedModel
  ) {
    throw new Error("Production readiness is not an exact-SHA 100% pass.");
  }
  const readinessFacts = Array.isArray(readiness.facts) ? readiness.facts : [];
  if (
    readinessFacts.length === 0 ||
    readinessFacts.some((entry) => object(entry, "readiness fact").passed !== true) ||
    nonEmptyStrings(readiness.failedCritical).length !== 0
  ) {
    throw new Error("Production readiness does not contain an all-passed fact ledger.");
  }
  const readinessFactIds = new Set(
    readinessFacts.map((entry) => object(entry, "readiness fact").id).filter(Boolean),
  );
  const missingReadinessFacts = REQUIRED_READINESS_FACTS.filter(
    (factId) => !readinessFactIds.has(factId),
  );
  if (missingReadinessFacts.length > 0) {
    throw new Error(
      `Production readiness omits required facts: ${missingReadinessFacts.join(", ")}.`,
    );
  }
  const roleIdentities = object(readiness.roleIdentities, "readiness.roleIdentities");
  const controlDirectorAgentId = requiredString(
    roleIdentities.controlDirectorAgentId,
    "readiness.roleIdentities.controlDirectorAgentId",
  );
  const programManagerAgentId = requiredString(
    roleIdentities.programManagerAgentId,
    "readiness.roleIdentities.programManagerAgentId",
  );
  const judgeAgentId = requiredString(
    roleIdentities.judgeAgentId,
    "readiness.roleIdentities.judgeAgentId",
  );
  if (new Set([controlDirectorAgentId, programManagerAgentId, judgeAgentId]).size !== 3) {
    throw new Error("Readiness operational role identities are not independent.");
  }
  const pursueGoal = object(runtimeProof.pursueGoal, "runtimeProof.pursueGoal");
  const delegation = object(runtimeProof.delegation, "runtimeProof.delegation");
  const judgeVerification = verifyControlDirectorJudgeEvidence({
    evidence: object(runtimeProof.judge, "runtimeProof.judge"),
    publicKeyPem: campaignJudgePublicKeyPem,
    expectedPublicKeyId: campaignJudgePublicKeyId,
    expectedJudgeAgentId: judgeAgentId,
    disallowedJudgeAgentIds: [controlDirectorAgentId, programManagerAgentId],
    disallowedJudgeRunIds: [
      requiredString(
        delegation.controlDirectorRunId,
        "runtimeProof.delegation.controlDirectorRunId",
      ),
      requiredString(delegation.programManagerRunId, "runtimeProof.delegation.programManagerRunId"),
      requiredString(delegation.workerRunId, "runtimeProof.delegation.workerRunId"),
    ],
    expectedMissionId: requiredString(pursueGoal.missionId, "runtimeProof.pursueGoal.missionId"),
    expectedArtifactIds: nonEmptyStrings(pursueGoal.artifactIds),
    expectedSourceSha: sourceSha,
    expectedRollbackSha: campaignRollbackSha,
    expectedActiveReleaseId,
    expectedRollbackReleaseId,
    expectedConfigurationDigest: campaignConfigDigest,
    expectedSelectedModel: String(lineage.selectedModel),
    expectedSelectedModelIdentity: selectedModelIdentity,
    expectedRuntimeHome: runtimeCertification.runtimeHome,
    notBefore: Date.parse(
      requiredString(pursueGoal.startedAt, "runtimeProof.pursueGoal.startedAt"),
    ),
    notAfter: Date.parse(requiredString(pursueGoal.checkedAt, "runtimeProof.pursueGoal.checkedAt")),
  });
  const runtimeJudgeVerification = object(
    runtimeProof.judgeVerification,
    "runtimeProof.judgeVerification",
  );
  if (
    runtimeJudgeVerification.publicKeyId !== judgeVerification.receipt.publicKeyId ||
    runtimeJudgeVerification.judgeAgentId !== judgeVerification.receipt.judgeAgentId ||
    runtimeJudgeVerification.judgeRunId !== judgeVerification.receipt.judgeRunId ||
    runtimeJudgeVerification.judgeModel !== judgeVerification.receipt.model ||
    runtimeJudgeVerification.claimHash !== judgeVerification.receipt.claimHash ||
    !isDeepStrictEqual(runtimeJudgeVerification.selectedModelIdentity, selectedModelIdentity) ||
    !isDeepStrictEqual(
      runtimeJudgeVerification.judgeModelIdentity,
      judgeVerification.receipt.campaignIssuance?.judgeModelIdentity,
    )
  ) {
    throw new Error("Runtime Judge verification projection does not match the signed receipt.");
  }
  const judgeModel = requiredString(
    judgeVerification.receipt.model,
    "runtimeProof.judge.receipt.model",
  );
  const judgeModelIdentity = object(
    judgeVerification.receipt.campaignIssuance?.judgeModelIdentity,
    "runtimeProof.judge.receipt.campaignIssuance.judgeModelIdentity",
  );
  const immutableModelDistinct =
    judgeModelIdentity.modelDigest !== selectedModelIdentity.modelDigest;
  const immutableCacheDistinct =
    judgeModelIdentity.cacheDigest !== selectedModelIdentity.cacheDigest;
  const selectedProvider = String(lineage.selectedModel).split("/", 1)[0];
  const judgeDiversity = {
    judgeAgentId,
    judgeModel,
    judgeProvider: judgeVerification.modelProvider,
    independentRoute: true,
    modelDistinct: immutableModelDistinct,
    cacheDistinct: immutableCacheDistinct,
    providerDistinct: judgeVerification.modelProvider !== selectedProvider,
    conflicts: [
      ...(!immutableModelDistinct ? ["same-model-digest"] : []),
      ...(!immutableCacheDistinct ? ["same-cache-digest"] : []),
    ],
  };

  const modelGovernanceProof = object(params.modelGovernanceProof, "modelGovernanceProof");
  exactSha(modelGovernanceProof.sourceSha, sourceSha, "modelGovernanceProof");
  if (
    modelGovernanceProof.schema !== CONTROL_DIRECTOR_MODEL_GOVERNANCE_PROOF_SCHEMA ||
    modelGovernanceProof.passed !== true ||
    !validDate(modelGovernanceProof.generatedAt) ||
    Date.parse(modelGovernanceProof.generatedAt) < Date.parse(readiness.generatedAt) ||
    Number(modelGovernanceProof.requiredQualityScore) < 93 ||
    Number(modelGovernanceProof.minimumQualityScore) <
      Number(completionPolicy.requiredQualityScore) ||
    nonEmptyStrings(modelGovernanceProof.failedCritical).length !== 0 ||
    nonEmptyStrings(modelGovernanceProof.evidenceRefs).length === 0
  ) {
    throw new Error("Model governance proof is not an exact-SHA 93+ all-passed v1 ledger.");
  }
  const modelGovernanceFacts = validateRequiredFactLedger(
    modelGovernanceProof.facts,
    "Model governance proof",
    REQUIRED_MODEL_GOVERNANCE_FACTS,
  );
  const statisticalEvaluation = object(
    modelGovernanceProof.statisticalEvaluation,
    "modelGovernanceProof.statisticalEvaluation",
  );
  if (
    statisticalEvaluation.trialCount !== modelResults.length ||
    statisticalEvaluation.passRate !== 100 ||
    statisticalEvaluation.criticalOmissions !== 0 ||
    Number(statisticalEvaluation.minimumQualityScore) <
      Number(completionPolicy.requiredQualityScore) ||
    statisticalEvaluation.minimumQualityScore !== Math.min(...qualityScores) ||
    statisticalEvaluation.trialSetDigest !== digestControlDirectorStatisticalTrials(modelResults)
  ) {
    throw new Error(
      "Model governance proof does not derive from the 48+ concrete exact-runtime trials.",
    );
  }
  const modelIdentity = object(
    modelGovernanceProof.modelIdentity,
    "modelGovernanceProof.modelIdentity",
  );
  if (
    modelIdentity.selectedModel !== lineage.selectedModel ||
    modelIdentity.sourceSha !== sourceSha ||
    !/^[a-f0-9]{64}$/u.test(String(modelIdentity.identityDigest ?? "")) ||
    !/^[a-f0-9]{64}$/u.test(String(modelIdentity.configDigest ?? "")) ||
    !/^[a-f0-9]{64}$/u.test(String(modelIdentity.modelDigest ?? "")) ||
    !/^[a-f0-9]{64}$/u.test(String(modelIdentity.cacheDigest ?? "")) ||
    modelIdentity.identityDigest !==
      digestModelGovernanceIdentity({
        sourceSha,
        selectedModel: modelIdentity.selectedModel,
        modelDigest: modelIdentity.modelDigest,
        configDigest: modelIdentity.configDigest,
        cacheDigest: modelIdentity.cacheDigest,
      })
  ) {
    throw new Error("Model governance proof model identity is not bound to the runtime route.");
  }
  if (expectedModel && modelIdentity.selectedModel !== expectedModel) {
    throw new Error("Model governance proof does not match the authorized model.");
  }
  if (expectedConfigDigest && modelIdentity.configDigest !== expectedConfigDigest) {
    throw new Error("Model governance proof does not match the authorized configuration digest.");
  }
  if (
    modelIdentity.modelDigest !== selectedModelIdentity.modelDigest ||
    modelIdentity.cacheDigest !== selectedModelIdentity.cacheDigest
  ) {
    throw new Error(
      "Model governance identity does not match the exact-runtime model evaluation identity.",
    );
  }
  const readinessModelEvidence = object(readiness.modelEvidence, "readiness.modelEvidence");
  if (
    readinessModelEvidence.modelDigest !== modelIdentity.modelDigest ||
    readinessModelEvidence.smokeModelId !==
      String(lineage.selectedModel).replace(/^ollama\//u, "") ||
    nonEmptyStrings(readinessModelEvidence.baseBlobDigests).length === 0
  ) {
    throw new Error("Readiness model bytes do not match the model-governance identity.");
  }
  const readinessCacheEvidence = object(readiness.cacheEvidence, "readiness.cacheEvidence");
  const recomputedCacheEvidence = buildControlDirectorCacheIdentityEvidence({
    selectedModel: readinessCacheEvidence.selectedModel,
    modelId: readinessCacheEvidence.modelId,
    modelDigest: readinessCacheEvidence.modelDigest,
    manifestDigest: readinessCacheEvidence.manifestDigest,
    baseBlobDigests: readinessCacheEvidence.baseBlobDigests,
    kvCacheType: readinessCacheEvidence.kvCacheType,
    residency: {
      modelId: readinessCacheEvidence.residentModelId,
      digest: readinessCacheEvidence.residentDigest,
      sizeBytes: readinessCacheEvidence.residentSizeBytes,
      vramBytes: readinessCacheEvidence.residentVramBytes,
    },
  });
  if (
    !isDeepStrictEqual(readinessCacheEvidence, recomputedCacheEvidence) ||
    modelIdentity.cacheDigest !== recomputedCacheEvidence.cacheDigest
  ) {
    throw new Error("Model-governance cache identity is not derived from live residency evidence.");
  }
  if (params.capabilityProof) {
    const capabilityManifest = object(params.capabilityManifest, "capabilityManifest");
    validateCapabilityProof(
      params.capabilityProof,
      sourceSha,
      [expectedConfigDigest, expectedSecondaryConfigDigest],
      capabilityManifest,
      expectedActiveReleaseId
        ? {
            activeReleaseId: expectedActiveReleaseId,
            rollbackReleaseId: expectedRollbackReleaseId,
            rollbackSha: expectedRollbackSha,
            leaseOwner: expectedLeaseOwner,
            approvalId: expectedApprovalId,
            operationId: expectedOperationId,
            invocationId: expectedInvocationId,
          }
        : undefined,
      expectedModel,
      params.verifyCapabilityArtifact,
    );
  }

  const stabilityProof = object(params.stabilityProof, "stabilityProof");
  exactSha(stabilityProof.sourceSha, sourceSha, "stabilityProof");
  if (
    stabilityProof.schema !== CONTROL_DIRECTOR_STABILITY_PROOF_SCHEMA ||
    stabilityProof.passed !== true ||
    !validDate(stabilityProof.generatedAt) ||
    Date.parse(stabilityProof.generatedAt) < Date.parse(modelGovernanceProof.generatedAt) ||
    nonEmptyStrings(stabilityProof.failedCritical).length !== 0 ||
    nonEmptyStrings(stabilityProof.evidenceRefs).length === 0
  ) {
    throw new Error("Stability proof is not an exact-SHA all-passed v1 ledger.");
  }
  validateRequiredFactLedger(stabilityProof.facts, "Stability proof", REQUIRED_STABILITY_FACTS);
  const monitoring = object(stabilityProof.monitoring, "stabilityProof.monitoring");
  const restoration = object(stabilityProof.restoration, "stabilityProof.restoration");
  const lifecycleReceipts = object(restoration.receipts, "stabilityProof.restoration.receipts");
  if (typeof params.verifyStabilityArtifact !== "function") {
    throw new Error("Stability proof requires independent lifecycle artifact verification.");
  }
  for (const name of ["acquired", "promoted", "rollbackAuthorized", "rolledBack", "restored"]) {
    const bindingValue = object(
      lifecycleReceipts[name],
      `stabilityProof.restoration.receipts.${name}`,
    );
    if (!params.verifyStabilityArtifact(bindingValue)) {
      throw new Error(`Stability lifecycle artifact ${name} failed digest verification.`);
    }
  }
  const monitoringSamples = Array.isArray(monitoring.samples) ? monitoring.samples : [];
  for (const [index, sampleValue] of monitoringSamples.entries()) {
    const sample = object(sampleValue, `stabilityProof.monitoring.samples[${index}]`);
    if (!params.verifyStabilityArtifact(sample)) {
      throw new Error(`Stability monitoring sample ${index} failed digest verification.`);
    }
    const sampleReceipt = object(
      sample.receipt,
      `stabilityProof.monitoring.samples[${index}].receipt`,
    );
    const sampleCacheEvidence = object(sampleReceipt.cacheEvidence, "cacheEvidence");
    if (!params.verifyStabilityArtifact(sampleCacheEvidence)) {
      throw new Error(`Stability monitoring cache evidence ${index} failed digest verification.`);
    }
    const verifyRuntimeIdentityEvidence =
      params.verifyRuntimeIdentityEvidence ?? verifyControlDirectorRuntimeIdentityEvidence;
    verifyRuntimeIdentityEvidence({
      cacheEvidence: object(sampleCacheEvidence.receipt, "cacheEvidence.receipt"),
      repoRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
      managedConfigPath: path.join(resolveStateDir(), "openclaw.director.json"),
      expected: {
        phase: "restored",
        sourceSha,
        activeReleaseId: expectedActiveReleaseId,
        selectedModel: expectedModel,
        configDigest: expectedConfigDigest,
        invocationId: expectedInvocationId,
      },
    });
    const capabilityObservationBinding = object(
      sampleReceipt.capabilityObservation,
      "capabilityObservation",
    );
    if (!params.verifyStabilityArtifact(capabilityObservationBinding)) {
      throw new Error(
        `Stability monitoring capability observation ${index} failed digest verification.`,
      );
    }
    const verifyStabilityCapabilityObservation =
      params.verifyStabilityCapabilityObservation ?? verifyControlDirectorCapabilityObservation;
    const capabilityObservation = verifyStabilityCapabilityObservation(
      object(capabilityObservationBinding.receipt, "capabilityObservation.receipt"),
    );
    if (
      capabilityObservation.phase !== "restored" ||
      capabilityObservation.sourceSha !== sourceSha ||
      capabilityObservation.releaseId !== sampleReceipt.activeReleaseId ||
      `ollama/${String(capabilityObservation.selectedModelId ?? "")}` !==
        sampleReceipt.selectedModel ||
      capabilityObservation.checkedAt !== sampleReceipt.checkedAt ||
      capabilityObservation.configurationDigests?.[0] !== sampleReceipt.configDigest ||
      capabilityObservation.contentSha256 !== sampleReceipt.capabilityObservationSha256 ||
      capabilityObservation.capabilities?.length !== 35
    ) {
      throw new Error(
        `Stability monitoring capability observation ${index} does not match its sample.`,
      );
    }
  }
  for (const name of [
    "preRollbackCache",
    "restoredCache",
    "preRollbackFallbackOrder",
    "restoredFallbackOrder",
  ]) {
    if (!params.verifyStabilityArtifact(object(restoration[name], `restoration.${name}`))) {
      throw new Error(`Stability restoration artifact ${name} failed digest verification.`);
    }
  }
  const verifyRuntimeIdentityEvidence =
    params.verifyRuntimeIdentityEvidence ?? verifyControlDirectorRuntimeIdentityEvidence;
  for (const [phase, cacheName, fallbackName] of [
    ["pre-rollback", "preRollbackCache", "preRollbackFallbackOrder"],
    ["restored", "restoredCache", "restoredFallbackOrder"],
  ]) {
    verifyRuntimeIdentityEvidence({
      cacheEvidence: object(
        object(restoration[cacheName], `restoration.${cacheName}`).receipt,
        `restoration.${cacheName}.receipt`,
      ),
      fallbackEvidence: object(
        object(restoration[fallbackName], `restoration.${fallbackName}`).receipt,
        `restoration.${fallbackName}.receipt`,
      ),
      repoRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
      managedConfigPath: path.join(resolveStateDir(), "openclaw.director.json"),
      expected: {
        phase,
        sourceSha,
        activeReleaseId: expectedActiveReleaseId,
        selectedModel: expectedModel,
        configDigest: expectedConfigDigest,
        invocationId: expectedInvocationId,
      },
    });
  }
  const recomputedStabilityProof = buildControlDirectorStabilityProof({
    sourceSha,
    generatedAt: stabilityProof.generatedAt,
    evidenceRefs: nonEmptyStrings(stabilityProof.evidenceRefs),
    monitoring: {
      samples: monitoringSamples,
    },
    restoration: {
      rollbackSha: restoration.rollbackSha,
      activeReleaseId: restoration.activeReleaseId,
      rollbackReleaseId: restoration.rollbackReleaseId,
      owner: restoration.owner,
      approvalId: restoration.approvalId,
      operationId: restoration.operationId,
      invocationId: restoration.invocationId,
      preRollbackCache: restoration.preRollbackCache,
      restoredCache: restoration.restoredCache,
      preRollbackFallbackOrder: restoration.preRollbackFallbackOrder,
      restoredFallbackOrder: restoration.restoredFallbackOrder,
      receipts: lifecycleReceipts,
    },
    facts: stabilityProof.facts,
  });
  if (
    (expectedRollbackSha && restoration.rollbackSha !== expectedRollbackSha) ||
    (expectedActiveReleaseId && restoration.activeReleaseId !== expectedActiveReleaseId) ||
    (expectedRollbackReleaseId && restoration.rollbackReleaseId !== expectedRollbackReleaseId) ||
    (expectedLeaseOwner && restoration.owner !== expectedLeaseOwner) ||
    (expectedApprovalId && restoration.approvalId !== expectedApprovalId) ||
    (expectedOperationId && restoration.operationId !== expectedOperationId) ||
    (expectedInvocationId && restoration.invocationId !== expectedInvocationId) ||
    monitoring.sourceSha !== sourceSha ||
    (expectedModel && monitoring.selectedModel !== expectedModel) ||
    (expectedConfigDigest && monitoring.configDigest !== expectedConfigDigest) ||
    (expectedActiveReleaseId && monitoring.activeReleaseId !== expectedActiveReleaseId) ||
    monitoring.sampleSetDigest !== recomputedStabilityProof.monitoring.sampleSetDigest ||
    monitoring.sampleCount !== recomputedStabilityProof.monitoring.sampleCount ||
    monitoring.startedAt !== recomputedStabilityProof.monitoring.startedAt ||
    monitoring.endedAt !== recomputedStabilityProof.monitoring.endedAt ||
    Number(monitoring.activeSoakMinutes) !==
      recomputedStabilityProof.monitoring.activeSoakMinutes ||
    Number(monitoring.passiveMonitorHours) !==
      recomputedStabilityProof.monitoring.passiveMonitorHours ||
    restoration.lifecycleReceiptSetDigest !==
      recomputedStabilityProof.restoration.lifecycleReceiptSetDigest ||
    !isDeepStrictEqual(
      restoration.preRollbackCache,
      recomputedStabilityProof.restoration.preRollbackCache,
    ) ||
    !isDeepStrictEqual(
      restoration.restoredCache,
      recomputedStabilityProof.restoration.restoredCache,
    ) ||
    !isDeepStrictEqual(
      restoration.preRollbackFallbackOrder,
      recomputedStabilityProof.restoration.preRollbackFallbackOrder,
    ) ||
    !isDeepStrictEqual(
      restoration.restoredFallbackOrder,
      recomputedStabilityProof.restoration.restoredFallbackOrder,
    )
  ) {
    throw new Error(
      "Stability proof does not derive from exact monitoring and lifecycle receipts.",
    );
  }
  if (expectedRollbackSha && runtimeProof.rollback.rollbackSha !== expectedRollbackSha) {
    throw new Error("Runtime rollback proof does not match the authorized rollback SHA.");
  }

  return {
    milestoneCount: milestones.length,
    passedMilestones: milestones.length,
    implementedMilestones: progress.implementedMilestones,
    certifiedMilestones: progress.certifiedMilestones,
    implementationPercent: progress.implementationPercent,
    certificationPercent: progress.certificationPercent,
    weightedCompletionPercent: 100,
    minimumQualityScore: Math.min(
      ...qualityScores,
      ...modelGovernanceFacts.map((fact) => Number(fact.qualityScore ?? 100)),
    ),
    requiredQualityScore: Number(completionPolicy.requiredQualityScore),
    judgeDiversity,
    evidenceBinding: binding,
  };
}

function parseArgs(argv) {
  const values = new Map();
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
  for (const key of [
    "source-sha",
    "expected-model",
    "expected-config-digest",
    "expected-secondary-config-digest",
    "expected-rollback-sha",
    "expected-active-release-id",
    "expected-rollback-release-id",
    "expected-lease-owner",
    "expected-approval-id",
    "expected-operation-id",
    "expected-invocation-id",
    "expected-campaign-judge-public-key-id",
    "roadmap",
    "source-proof",
    "update-survival",
    "runtime-proof",
    "local-validation-proof",
    "readiness",
    "model-governance-proof",
    "stability-proof",
    "capability-proof",
    "output",
  ]) {
    if (!values.get(key)) {
      throw new Error(`Missing --${key}.`);
    }
  }
  return values;
}

function parseAuthorityArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--") {
      continue;
    }
    if (!key?.startsWith("--")) {
      throw new Error(`Unknown authority-verification argument: ${key ?? ""}`);
    }
    const value = argv[++index];
    if (!value) {
      throw new Error(`Missing value for ${key}.`);
    }
    values.set(key.slice(2), value);
  }
  for (const key of [
    "authority",
    "source-sha",
    "expected-model",
    "expected-config-digest",
    "expected-secondary-config-digest",
    "expected-rollback-sha",
    "expected-active-release-id",
    "expected-rollback-release-id",
    "expected-lease-owner",
    "expected-approval-id",
    "expected-operation-id",
    "expected-invocation-id",
    "expected-campaign-judge-public-key-id",
  ]) {
    if (!values.get(key)) {
      throw new Error(`Missing --${key}.`);
    }
  }
  return values;
}

function expectedAuthorityFromArgs(args, judgePublicKeyId, campaignJudgePublicKeyId) {
  const sourceSha = immutableSha(args.get("source-sha"), "sourceSha");
  const expectedModel = args.get("expected-model").trim();
  if (!expectedModel.includes("/")) {
    throw new Error("--expected-model must be a provider-qualified model reference.");
  }
  const expectedConfigDigest = args.get("expected-config-digest").toLowerCase();
  const expectedSecondaryConfigDigest = args.get("expected-secondary-config-digest").toLowerCase();
  if (
    !SHA256_PATTERN.test(expectedConfigDigest) ||
    !SHA256_PATTERN.test(expectedSecondaryConfigDigest)
  ) {
    throw new Error("Expected configuration digests must be lowercase SHA-256 digests.");
  }
  const expectedRollbackSha = immutableSha(
    args.get("expected-rollback-sha"),
    "expectedRollbackSha",
  );
  const expectedActiveReleaseId = typedIdentity(
    args.get("expected-active-release-id"),
    "expectedActiveReleaseId",
  );
  const expectedRollbackReleaseId = typedIdentity(
    args.get("expected-rollback-release-id"),
    "expectedRollbackReleaseId",
  );
  if (expectedActiveReleaseId === expectedRollbackReleaseId) {
    throw new Error("Expected active and rollback release IDs must differ.");
  }
  const expectedCampaignJudgePublicKeyId = args
    .get("expected-campaign-judge-public-key-id")
    .toLowerCase();
  if (
    !SHA256_PATTERN.test(expectedCampaignJudgePublicKeyId) ||
    expectedCampaignJudgePublicKeyId !== campaignJudgePublicKeyId ||
    expectedCampaignJudgePublicKeyId === judgePublicKeyId
  ) {
    throw new Error(
      "Expected campaign Judge public key must match the distinct managed trust root.",
    );
  }
  return {
    sourceSha,
    authorizationBindings: {
      expectedModel,
      expectedConfigDigest,
      expectedSecondaryConfigDigest,
      expectedRollbackSha,
      expectedActiveReleaseId,
      expectedRollbackReleaseId,
      expectedLeaseOwner: typedIdentity(args.get("expected-lease-owner"), "expectedLeaseOwner"),
      expectedApprovalId: typedIdentity(args.get("expected-approval-id"), "expectedApprovalId"),
      expectedOperationId: typedIdentity(args.get("expected-operation-id"), "expectedOperationId"),
      expectedInvocationId: typedIdentity(
        args.get("expected-invocation-id"),
        "expectedInvocationId",
      ),
      expectedJudgePublicKeyId: judgePublicKeyId,
      expectedCampaignJudgePublicKeyId,
    },
  };
}

function verifyAuthorityMain(argv) {
  const args = parseAuthorityArgs(argv);
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const judgePublicKeyPath = path.join(
    resolveStateDir(),
    "credentials",
    "judge-receipt-ed25519-public.pem",
  );
  const judgePublicKeyPem = fs.readFileSync(judgePublicKeyPath, "utf8");
  const judgePublicKeyId = createHash("sha256")
    .update(createPublicKey(judgePublicKeyPem).export({ type: "spki", format: "der" }))
    .digest("hex");
  const campaignJudgePublicKeyPath = path.join(
    resolveStateDir(),
    "credentials",
    "judge-campaign-receipt-ed25519-public.pem",
  );
  const campaignJudgePublicKeyPem = fs.readFileSync(campaignJudgePublicKeyPath, "utf8");
  const campaignJudgePublicKeyId = createHash("sha256")
    .update(createPublicKey(campaignJudgePublicKeyPem).export({ type: "spki", format: "der" }))
    .digest("hex");
  const expected = expectedAuthorityFromArgs(args, judgePublicKeyId, campaignJudgePublicKeyId);
  const head = git(repoRoot, ["rev-parse", "HEAD"]).toLowerCase();
  if (head !== expected.sourceSha) {
    throw new Error(`HEAD ${head} does not match ${expected.sourceSha}.`);
  }
  if (git(repoRoot, ["status", "--porcelain=v1", "--untracked-files=all"])) {
    throw new Error("Source checkout is not clean.");
  }
  const result = verifyControlDirectorFinalLedgerAuthority({
    repoRoot,
    authorityPath: path.resolve(args.get("authority")),
    expected,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const sourceSha = immutableSha(args.get("source-sha"), "sourceSha");
  const expectedModel = args.get("expected-model").trim();
  if (!expectedModel.includes("/")) {
    throw new Error("--expected-model must be a provider-qualified model reference.");
  }
  const expectedConfigDigest = args.get("expected-config-digest").toLowerCase();
  if (!SHA256_PATTERN.test(expectedConfigDigest)) {
    throw new Error("--expected-config-digest must be a 64-character lowercase SHA-256 digest.");
  }
  const expectedSecondaryConfigDigest = args.get("expected-secondary-config-digest").toLowerCase();
  if (!SHA256_PATTERN.test(expectedSecondaryConfigDigest)) {
    throw new Error(
      "--expected-secondary-config-digest must be a 64-character lowercase SHA-256 digest.",
    );
  }
  const expectedRollbackSha = immutableSha(
    args.get("expected-rollback-sha"),
    "expectedRollbackSha",
  );
  const expectedActiveReleaseId = typedIdentity(
    args.get("expected-active-release-id"),
    "expectedActiveReleaseId",
  );
  const expectedRollbackReleaseId = typedIdentity(
    args.get("expected-rollback-release-id"),
    "expectedRollbackReleaseId",
  );
  if (expectedActiveReleaseId === expectedRollbackReleaseId) {
    throw new Error("Expected active and rollback release IDs must differ.");
  }
  const expectedLeaseOwner = typedIdentity(args.get("expected-lease-owner"), "expectedLeaseOwner");
  const expectedApprovalId = typedIdentity(args.get("expected-approval-id"), "expectedApprovalId");
  const expectedOperationId = typedIdentity(
    args.get("expected-operation-id"),
    "expectedOperationId",
  );
  const expectedInvocationId = typedIdentity(
    args.get("expected-invocation-id"),
    "expectedInvocationId",
  );
  const judgePublicKeyPath = path.join(
    resolveStateDir(),
    "credentials",
    "judge-receipt-ed25519-public.pem",
  );
  const judgePublicKeyPem = fs.readFileSync(judgePublicKeyPath, "utf8");
  const expectedJudgePublicKeyId = createHash("sha256")
    .update(createPublicKey(judgePublicKeyPem).export({ type: "spki", format: "der" }))
    .digest("hex");
  const campaignJudgePublicKeyPath = path.join(
    resolveStateDir(),
    "credentials",
    "judge-campaign-receipt-ed25519-public.pem",
  );
  const campaignJudgePublicKeyPem = fs.readFileSync(campaignJudgePublicKeyPath, "utf8");
  const expectedCampaignJudgePublicKeyId = args
    .get("expected-campaign-judge-public-key-id")
    .toLowerCase();
  const managedCampaignJudgePublicKeyId = createHash("sha256")
    .update(createPublicKey(campaignJudgePublicKeyPem).export({ type: "spki", format: "der" }))
    .digest("hex");
  if (
    !SHA256_PATTERN.test(expectedCampaignJudgePublicKeyId) ||
    expectedCampaignJudgePublicKeyId !== managedCampaignJudgePublicKeyId ||
    expectedCampaignJudgePublicKeyId === expectedJudgePublicKeyId
  ) {
    throw new Error(
      "Expected campaign Judge public key must match the distinct managed trust root.",
    );
  }
  const roadmapPath = path.resolve(args.get("roadmap"));
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  if (!controlDirectorRoadmapPathMatchesCanonical(roadmapPath, repoRoot)) {
    throw new Error(`--roadmap must be the canonical ${CANONICAL_ROADMAP_PATH}.`);
  }
  const head = git(repoRoot, ["rev-parse", "HEAD"]).toLowerCase();
  if (head !== sourceSha) {
    throw new Error(`HEAD ${head} does not match ${sourceSha}.`);
  }
  if (git(repoRoot, ["status", "--porcelain=v1", "--untracked-files=all"])) {
    throw new Error("Source checkout is not clean.");
  }
  const inputPaths = {
    sourceProof: path.resolve(args.get("source-proof")),
    updateSurvival: path.resolve(args.get("update-survival")),
    runtimeProof: path.resolve(args.get("runtime-proof")),
    localValidationProof: path.resolve(args.get("local-validation-proof")),
    readiness: path.resolve(args.get("readiness")),
    modelGovernanceProof: path.resolve(args.get("model-governance-proof")),
    stabilityProof: path.resolve(args.get("stability-proof")),
    capabilityProof: path.resolve(args.get("capability-proof")),
  };
  const roadmap = readJson(roadmapPath);
  const sourceProof = readJson(inputPaths.sourceProof);
  if (!controlDirectorSourceProofMatchesRoot(sourceProof.sourceRoot, repoRoot)) {
    throw new Error("sourceProof sourceRoot does not match the current repository root.");
  }
  const evidence = {
    sourceProof,
    updateSurvival: readJson(inputPaths.updateSurvival),
    runtimeProof: readJson(inputPaths.runtimeProof),
    localValidationProof: readJson(inputPaths.localValidationProof),
    readiness: readJson(inputPaths.readiness),
    modelGovernanceProof: readJson(inputPaths.modelGovernanceProof),
    stabilityProof: readJson(inputPaths.stabilityProof),
    capabilityProof: readJson(inputPaths.capabilityProof),
  };
  const capabilityManifest = readJson(
    path.join(repoRoot, "config/custom-runtime-capabilities.json"),
  );
  const milestoneAudit = auditControlDirectorMilestones({
    rootDir: repoRoot,
    roadmapPath: CANONICAL_ROADMAP_PATH,
  });
  const preliminaryProjection = buildCertifiedControlDirectorRoadmapProjection({
    roadmap,
    milestoneAudit,
  });
  const validation = validateControlDirectorRoadmap({
    roadmap: preliminaryProjection,
    sourceSha,
    expectedModel,
    expectedConfigDigest,
    expectedSecondaryConfigDigest,
    expectedRollbackSha,
    expectedActiveReleaseId,
    expectedRollbackReleaseId,
    expectedLeaseOwner,
    expectedApprovalId,
    expectedOperationId,
    expectedInvocationId,
    capabilityManifest,
    judgePublicKeyPem,
    expectedJudgePublicKeyId,
    campaignJudgePublicKeyPem,
    expectedCampaignJudgePublicKeyId,
    readRuntimeSoakArtifact: (bindingValue) => readContainedArtifact(repoRoot, bindingValue),
    verifyStabilityArtifact: (bindingValue) => {
      const candidate = path.resolve(repoRoot, bindingValue.path);
      const relative = path.relative(repoRoot, candidate);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        return false;
      }
      try {
        return (
          fs.statSync(candidate).isFile() &&
          digest(candidate) === bindingValue.sha256 &&
          isDeepStrictEqual(readJson(candidate), bindingValue.receipt)
        );
      } catch {
        return false;
      }
    },
    verifyModelEvalArtifact: (artifact) => {
      const candidate = path.resolve(repoRoot, artifact.path);
      const relative = path.relative(repoRoot, candidate);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        return false;
      }
      try {
        return fs.statSync(candidate).isFile() && digest(candidate) === artifact.sha256;
      } catch {
        return false;
      }
    },
    ...evidence,
  });
  const bindings = object(roadmap.evidenceBinding, "evidenceBinding");
  for (const [name, inputPath] of Object.entries(inputPaths)) {
    const expected = resolveBinding(repoRoot, bindings[name], sourceSha);
    if (expected !== inputPath) {
      throw new Error(`${name} path does not match its roadmap binding.`);
    }
  }
  const output = path.resolve(args.get("output"));
  const expectedOutput = resolveBinding(repoRoot, bindings.finalReceipt, sourceSha);
  if (expectedOutput !== output) {
    throw new Error("output path does not match evidenceBinding.finalReceipt.");
  }
  const checkedAt = [
    sourceProof.completedAt,
    evidence.updateSurvival.checkedAt,
    evidence.runtimeProof.generatedAt,
    evidence.localValidationProof.generatedAt,
    evidence.readiness.generatedAt,
    evidence.modelGovernanceProof.generatedAt,
    evidence.stabilityProof.generatedAt,
    evidence.capabilityProof.checkedAt,
  ].toSorted((left, right) => Date.parse(right) - Date.parse(left))[0];
  const receipt = {
    schema: "openclaw.control-director-final-ledger.v3",
    sourceSha,
    executionPlatform: "mac-studio",
    remoteExecutionRequired: false,
    authorizationBindings: {
      expectedModel,
      expectedConfigDigest,
      expectedSecondaryConfigDigest,
      expectedRollbackSha,
      expectedActiveReleaseId,
      expectedRollbackReleaseId,
      expectedLeaseOwner,
      expectedApprovalId,
      expectedOperationId,
      expectedInvocationId,
      expectedJudgePublicKeyId,
      expectedCampaignJudgePublicKeyId,
    },
    checkedAt,
    passed: true,
    ...validation,
    artifacts: {
      roadmap: { path: roadmapPath, sha256: digest(roadmapPath) },
      judgePublicKey: { path: judgePublicKeyPath, sha256: digest(judgePublicKeyPath) },
      campaignJudgePublicKey: {
        path: campaignJudgePublicKeyPath,
        sha256: digest(campaignJudgePublicKeyPath),
      },
      ...Object.fromEntries(
        Object.entries(inputPaths).map(([name, filePath]) => [
          name,
          { path: filePath, sha256: digest(filePath) },
        ]),
      ),
    },
    ownerAcceptance: {
      required: true,
      owner: "Matthew",
      status: "pending",
      recordedAt: null,
    },
  };
  const receiptText = `${JSON.stringify(receipt, null, 2)}\n`;
  const receiptSha256 = digestText(receiptText);
  const generationRoot = path.join(
    path.dirname(output),
    "final-ledger-generations",
    sourceSha,
    receiptSha256,
  );
  const generationLedger = path.join(generationRoot, "ledger.json");
  const generationProjection = path.join(generationRoot, "certified-roadmap.json");
  const generationManifest = path.join(generationRoot, "manifest.json");
  const finalReceiptRelativePath = path.relative(repoRoot, generationLedger);
  const certifiedProjection = buildCertifiedControlDirectorRoadmapProjection({
    roadmap,
    milestoneAudit,
    finalReceiptPath: finalReceiptRelativePath,
    finalReceiptSha256: receiptSha256,
  });
  validateControlDirectorRoadmap({
    roadmap: certifiedProjection,
    sourceSha,
    expectedModel,
    expectedConfigDigest,
    expectedSecondaryConfigDigest,
    expectedRollbackSha,
    expectedActiveReleaseId,
    expectedRollbackReleaseId,
    expectedLeaseOwner,
    expectedApprovalId,
    expectedOperationId,
    expectedInvocationId,
    capabilityManifest,
    judgePublicKeyPem,
    expectedJudgePublicKeyId,
    campaignJudgePublicKeyPem,
    expectedCampaignJudgePublicKeyId,
    readRuntimeSoakArtifact: (bindingValue) => readContainedArtifact(repoRoot, bindingValue),
    verifyStabilityArtifact: (bindingValue) => {
      const candidate = path.resolve(repoRoot, bindingValue.path);
      const relative = path.relative(repoRoot, candidate);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        return false;
      }
      try {
        return (
          fs.statSync(candidate).isFile() &&
          digest(candidate) === bindingValue.sha256 &&
          isDeepStrictEqual(readJson(candidate), bindingValue.receipt)
        );
      } catch {
        return false;
      }
    },
    verifyModelEvalArtifact: (artifact) => {
      const candidate = path.resolve(repoRoot, artifact.path);
      const relative = path.relative(repoRoot, candidate);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        return false;
      }
      try {
        return fs.statSync(candidate).isFile() && digest(candidate) === artifact.sha256;
      } catch {
        return false;
      }
    },
    requireProjectionContract: true,
    finalReceiptPath: finalReceiptRelativePath,
    finalReceiptSha256: receiptSha256,
    ...evidence,
  });
  const projectionText = `${JSON.stringify(certifiedProjection, null, 2)}\n`;
  const projectionSha256 = digestText(projectionText);
  const generationManifestValue = {
    schema: "openclaw.control-director-final-ledger-generation.v1",
    sourceSha,
    checkedAt,
    ledger: { path: path.relative(repoRoot, generationLedger), sha256: receiptSha256 },
    certifiedProjection: {
      path: path.relative(repoRoot, generationProjection),
      sha256: projectionSha256,
    },
  };
  const generationManifestText = `${JSON.stringify(generationManifestValue, null, 2)}\n`;
  const generationManifestSha256 = digestText(generationManifestText);
  const generationTemporary = `${generationRoot}.tmp-${process.pid}`;
  fs.mkdirSync(generationTemporary, { recursive: true, mode: 0o700 });
  writePrivateTemporary(path.join(generationTemporary, "ledger.json"), receiptText);
  writePrivateTemporary(path.join(generationTemporary, "certified-roadmap.json"), projectionText);
  writePrivateTemporary(path.join(generationTemporary, "manifest.json"), generationManifestText);
  fsyncDirectory(generationTemporary);
  fs.mkdirSync(path.dirname(generationRoot), { recursive: true, mode: 0o700 });
  if (fs.existsSync(generationRoot)) {
    if (
      digest(generationLedger) !== receiptSha256 ||
      digest(generationProjection) !== projectionSha256 ||
      digest(generationManifest) !== generationManifestSha256
    ) {
      throw new Error("Existing final-ledger generation conflicts with the exact evidence set.");
    }
    fs.rmSync(generationTemporary, { recursive: true });
  } else {
    fs.renameSync(generationTemporary, generationRoot);
    fsyncDirectory(path.dirname(generationRoot));
  }
  const authority = buildControlDirectorFinalLedgerAuthority({
    sourceSha,
    checkedAt,
    manifestPath: path.relative(repoRoot, generationManifest),
    manifestSha256: generationManifestSha256,
    ledgerPath: path.relative(repoRoot, generationLedger),
    ledgerSha256: receiptSha256,
    projectionPath: path.relative(repoRoot, generationProjection),
    projectionSha256,
  });
  const authorityText = `${JSON.stringify(authority, null, 2)}\n`;
  writePrivateAtomic(output, authorityText);
  const reopenedAuthority = verifyFinalLedgerAuthorityArtifacts(repoRoot, output).authority;
  if (!isDeepStrictEqual(reopenedAuthority, authority)) {
    throw new Error("Final-ledger authority pointer changed while being committed.");
  }
  process.stdout.write(`${output}\n`);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === "verify-authority") {
      verifyAuthorityMain(process.argv.slice(3));
    } else {
      main();
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

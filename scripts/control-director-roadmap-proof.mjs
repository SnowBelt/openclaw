#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  CONTROL_DIRECTOR_MODEL_GOVERNANCE_FACT_IDS,
  CONTROL_DIRECTOR_MODEL_GOVERNANCE_PROOF_SCHEMA,
  CONTROL_DIRECTOR_STABILITY_FACT_IDS,
  CONTROL_DIRECTOR_STABILITY_PROOF_SCHEMA,
} from "../src/agents/control-director-model-governance-proof.js";
const CONTROL_DIRECTOR_UX_SLOS = Object.freeze({
  ackMs: 500,
  firstActivityMs: 2_000,
  activityHeartbeatMs: 15_000,
  cancelAckMs: 1_000,
  warmSubstantiveResponseMs: 8_000,
  coldSubstantiveResponseMs: 25_000,
  recentRecallTopK: 3,
  outputQualityMinimum: 93,
});

const SHA_PATTERN = /^[a-f0-9]{40}$/u;
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
  "remote-ci",
  "landing",
  "update-survival",
  "managed-runtime",
  "dashboard-desktop",
  "dashboard-tablet",
  "dashboard-mobile",
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
  "remoteProof",
  "readiness",
  "modelGovernanceProof",
  "stabilityProof",
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
  "desktop",
  "tablet",
  "mobile",
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
const MODEL_EVAL_TASK_CLASSES = [
  "conversation",
  "recall",
  "planning",
  "delegation",
  "steering",
  "verification",
];
const MINIMUM_SOAK_MS = 300_000;
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
  M68: ["sourceProof", "updateSurvival", "runtimeProof", "remoteProof", "readiness"],
  M85: ["runtimeProof", "readiness"],
  M86: ["sourceProof", "updateSurvival", "runtimeProof", "remoteProof", "readiness"],
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
    "remoteProof",
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

function digest(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
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
  if (["desktop", "tablet", "mobile"].includes(name)) {
    const viewport = object(surface.viewport, `runtimeProof.${name}.viewport`);
    if (
      finiteNonNegative(viewport.width, `runtimeProof.${name}.viewport.width`) <= 0 ||
      finiteNonNegative(viewport.height, `runtimeProof.${name}.viewport.height`) <= 0
    ) {
      throw new Error(`Runtime surface ${name} viewport dimensions must be positive.`);
    }
    for (const field of [
      "transcriptVisible",
      "composerVisible",
      "pccOverlapFree",
      "truthCompletionOverlapFree",
    ]) {
      requiredTrue(surface[field], `runtimeProof.${name}.${field}`);
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
      requiredString(surface.receiptId, "runtimeProof.judge.receiptId");
      requiredTrue(surface.independent, "runtimeProof.judge.independent");
      requiredTrue(surface.signatureVerified, "runtimeProof.judge.signatureVerified");
      requiredTrue(surface.claimBound, "runtimeProof.judge.claimBound");
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
    throw new Error("Roadmap identity is not Control Director Reliability V3.");
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

export function validateControlDirectorRoadmap(params) {
  const roadmap = object(params.roadmap, "roadmap");
  const sourceSha = immutableSha(params.sourceSha, "sourceSha");
  const progress = summarizeControlDirectorProgress(roadmap);
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
    if (
      evidence.some((entry) => entry.startsWith("workflow:")) &&
      !evidence.includes("binding:remoteProof")
    ) {
      throw new Error(`${milestone.id} workflow evidence is not bound to remoteProof.`);
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
  if (runtimeProof.schemaVersion !== 2 || runtimeProof.sigBackgroundEnabled !== true) {
    throw new Error("Runtime proof is not the managed SIG-enabled v2 contract.");
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
  const runtimeArtifacts = object(runtimeProof.artifacts, "runtimeProof.artifacts");
  const lineageArtifact = object(runtimeArtifacts.lineage, "runtimeProof.artifacts.lineage");
  if (!/^[a-f0-9]{64}$/u.test(String(lineageArtifact.sha256 ?? ""))) {
    throw new Error("Runtime lineage artifact is not digest-bound.");
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
  const modelResults = Array.isArray(modelEval.results) ? modelEval.results : [];
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
    qualityScores.length === 0 ||
    qualityScores.some(
      (score) => !Number.isFinite(score) || score < Number(completionPolicy.requiredQualityScore),
    )
  ) {
    throw new Error("At least one model-evaluation quality score is below the roadmap minimum.");
  }

  const remoteProof = object(params.remoteProof, "remoteProof");
  exactSha(remoteProof.sourceSha, sourceSha, "remoteProof");
  if (
    remoteProof.schema !== "openclaw.control-director-remote-gates.v1" ||
    remoteProof.passed !== true ||
    !validDate(remoteProof.generatedAt) ||
    nonEmptyStrings(remoteProof.evidenceRefs).length === 0
  ) {
    throw new Error("Remote proof is not a timestamped evidence-backed v1 pass.");
  }
  const remoteGeneratedAt = Date.parse(remoteProof.generatedAt);
  for (const gate of ["workflowSanity", "nonAndroidCi"]) {
    const value = object(remoteProof[gate], `remoteProof.${gate}`);
    const jobs = Array.isArray(value.jobs)
      ? value.jobs.map((entry) => object(entry, `remoteProof.${gate}.job`))
      : [];
    const acceptedJobs = jobs.filter(
      (job) =>
        job.status === "completed" &&
        ["success", "skipped", "neutral"].includes(String(job.conclusion)),
    );
    if (
      !Number.isInteger(value.runId) ||
      value.runId <= 0 ||
      typeof value.runUrl !== "string" ||
      !value.runUrl.includes(`/actions/runs/${String(value.runId)}`) ||
      !validDate(value.checkedAt) ||
      Date.parse(value.checkedAt) > remoteGeneratedAt ||
      nonEmptyStrings(value.evidenceRefs).length === 0 ||
      value.status !== "completed" ||
      value.conclusion !== "success" ||
      value.headSha !== sourceSha ||
      jobs.length === 0 ||
      jobs.some(
        (job) =>
          !Number.isInteger(job.id) ||
          job.id <= 0 ||
          typeof job.name !== "string" ||
          !job.name.trim(),
      ) ||
      new Set(jobs.map((job) => job.id)).size !== jobs.length ||
      !jobs.some((job) => job.conclusion === "success") ||
      value.totalJobs !== jobs.length ||
      value.acceptedJobs !== acceptedJobs.length ||
      acceptedJobs.length !== jobs.length
    ) {
      throw new Error(`${gate} is not an all-jobs exact-SHA success.`);
    }
  }
  const landing = object(remoteProof.landing, "remoteProof.landing");
  if (
    landing.merged !== true ||
    landing.mergeSha !== sourceSha ||
    !Number.isInteger(landing.pullRequest) ||
    landing.pullRequest <= 0 ||
    !validDate(landing.mergedAt) ||
    Date.parse(landing.mergedAt) > remoteGeneratedAt ||
    nonEmptyStrings(landing.evidenceRefs).length === 0
  ) {
    throw new Error("Remote landing does not bind the exact source SHA.");
  }
  const landingAt = Date.parse(landing.mergedAt);
  if (
    Date.parse(sourceProof.completedAt) > remoteGeneratedAt ||
    Date.parse(updateSurvival.checkedAt) > remoteGeneratedAt
  ) {
    throw new Error("Exact-source proof must complete before the remote proof bundle.");
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
    statisticalEvaluation.trialCount < 48 ||
    statisticalEvaluation.passRate !== 100 ||
    statisticalEvaluation.criticalOmissions !== 0 ||
    Number(statisticalEvaluation.minimumQualityScore) <
      Number(completionPolicy.requiredQualityScore)
  ) {
    throw new Error("Model governance proof does not satisfy the 48-trial quality floor.");
  }
  const modelIdentity = object(
    modelGovernanceProof.modelIdentity,
    "modelGovernanceProof.modelIdentity",
  );
  if (
    modelIdentity.selectedModel !== lineage.selectedModel ||
    modelIdentity.sourceSha !== sourceSha ||
    !/^[a-f0-9]{64}$/u.test(String(modelIdentity.identityDigest ?? "")) ||
    !/^[a-f0-9]{64}$/u.test(String(modelIdentity.configDigest ?? ""))
  ) {
    throw new Error("Model governance proof model identity is not bound to the runtime route.");
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
  if (
    Number(monitoring.activeSoakMinutes) < 30 ||
    Number(monitoring.passiveMonitorHours) < 24 ||
    monitoring.routeDriftDetected !== false ||
    monitoring.capabilityLossDetected !== false
  ) {
    throw new Error("Stability proof does not satisfy active/passive monitoring requirements.");
  }
  const restoration = object(stabilityProof.restoration, "stabilityProof.restoration");
  if (
    restoration.rollbackRestored !== true ||
    restoration.fallbackOrderRestored !== true ||
    restoration.cacheIdentityRestored !== true ||
    restoration.proofStateRestored !== true
  ) {
    throw new Error("Stability proof does not prove rollback and fallback restoration.");
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
    "roadmap",
    "source-proof",
    "update-survival",
    "runtime-proof",
    "remote-proof",
    "readiness",
    "model-governance-proof",
    "stability-proof",
    "output",
  ]) {
    if (!values.get(key)) {
      throw new Error(`Missing --${key}.`);
    }
  }
  return values;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceSha = immutableSha(args.get("source-sha"), "sourceSha");
  const roadmapPath = path.resolve(args.get("roadmap"));
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
    remoteProof: path.resolve(args.get("remote-proof")),
    readiness: path.resolve(args.get("readiness")),
    modelGovernanceProof: path.resolve(args.get("model-governance-proof")),
    stabilityProof: path.resolve(args.get("stability-proof")),
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
    updateSurvival: readJson(inputPaths.updateSurvival),
    runtimeProof: readJson(inputPaths.runtimeProof),
    remoteProof: readJson(inputPaths.remoteProof),
    readiness: readJson(inputPaths.readiness),
    modelGovernanceProof: readJson(inputPaths.modelGovernanceProof),
    stabilityProof: readJson(inputPaths.stabilityProof),
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
  const receipt = {
    schema: "openclaw.control-director-final-ledger.v2",
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

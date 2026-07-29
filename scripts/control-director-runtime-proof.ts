#!/usr/bin/env node
// Assemble a production-readiness receipt only from exact-SHA runtime evidence files.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { CONTROL_DIRECTOR_UX_SLOS } from "../src/agents/control-director-slos.js";

const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const MINIMUM_SOAK_MS = 300_000;
const SURFACES = [
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
] as const;

type Surface = (typeof SURFACES)[number];
type JsonObject = Record<string, unknown>;

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as JsonObject;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
    : [];
}

function readJson(filePath: string): JsonObject {
  return object(JSON.parse(fs.readFileSync(filePath, "utf8")), filePath);
}

function digest(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function exactSha(value: unknown, expected: string, label: string): void {
  if (value !== expected) {
    throw new Error(`${label} sourceSha does not match ${expected}.`);
  }
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} requires a non-empty string.`);
  }
  return value.trim();
}

function requiredTrue(value: unknown, label: string): void {
  if (value !== true) {
    throw new Error(`${label} must be true.`);
  }
}

function finiteNonNegative(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} requires a non-negative finite number.`);
  }
  return value;
}

function validateLatencySample(
  value: unknown,
  label: string,
  substantiveResponseLimitMs: number,
): void {
  const sample = object(value, label);
  const measurements = [
    ["ackMs", CONTROL_DIRECTOR_UX_SLOS.ackMs],
    ["firstActivityMs", CONTROL_DIRECTOR_UX_SLOS.firstActivityMs],
    ["maximumActivityGapMs", CONTROL_DIRECTOR_UX_SLOS.activityHeartbeatMs],
    ["cancelAckMs", CONTROL_DIRECTOR_UX_SLOS.cancelAckMs],
    ["substantiveResponseMs", substantiveResponseLimitMs],
  ] as const;
  for (const [field, limit] of measurements) {
    const observed = finiteNonNegative(sample[field], `${label}.${field}`);
    if (observed > limit) {
      throw new Error(`${label}.${field} exceeds the ${limit}ms Control Director SLO.`);
    }
  }
}

function validateSurfaceContract(surface: Surface, value: JsonObject): void {
  switch (surface) {
    case "macStudioDashboard": {
      if (value.platform !== "mac-studio") {
        throw new Error("macStudioDashboard.platform must be mac-studio.");
      }
      const host = object(value.host, "macStudioDashboard.host");
      if (
        host.hardwareClass !== "Mac Studio" ||
        host.osName !== "macOS" ||
        host.architecture !== "arm64"
      ) {
        throw new Error("macStudioDashboard.host must identify an arm64 Mac Studio running macOS.");
      }
      requiredString(host.osVersion, "macStudioDashboard.host.osVersion");
      const hostIdentitySha256 = requiredString(
        host.hostIdentitySha256,
        "macStudioDashboard.host.hostIdentitySha256",
      );
      if (!SHA256_PATTERN.test(hostIdentitySha256)) {
        throw new Error(
          "macStudioDashboard.host.hostIdentitySha256 must be a 64-character digest.",
        );
      }
      requiredString(value.browserName, "macStudioDashboard.browserName");
      requiredString(value.browserVersion, "macStudioDashboard.browserVersion");
      const viewport = object(value.viewport, "macStudioDashboard.viewport");
      if (
        finiteNonNegative(viewport.width, "macStudioDashboard.viewport.width") <= 0 ||
        finiteNonNegative(viewport.height, "macStudioDashboard.viewport.height") <= 0
      ) {
        throw new Error("macStudioDashboard viewport dimensions must be positive.");
      }
      requiredTrue(value.transcriptVisible, "macStudioDashboard.transcriptVisible");
      requiredTrue(value.composerVisible, "macStudioDashboard.composerVisible");
      requiredTrue(value.keyboardPassed, "macStudioDashboard.keyboardPassed");
      requiredTrue(value.accessibilityPassed, "macStudioDashboard.accessibilityPassed");
      requiredTrue(value.pccOverlapFree, "macStudioDashboard.pccOverlapFree");
      requiredTrue(
        value.truthCompletionOverlapFree,
        "macStudioDashboard.truthCompletionOverlapFree",
      );
      return;
    }
    case "localModelRouting":
      if (value.route !== "local") {
        throw new Error("localModelRouting.route must be local.");
      }
      requiredString(value.modelRef, "localModelRouting.modelRef");
      if (finiteNonNegative(value.qualityScore, "localModelRouting.qualityScore") < 93) {
        throw new Error("localModelRouting.qualityScore must be at least 93.");
      }
      return;
    case "localModelLatency":
      validateLatencySample(
        value.cold,
        "localModelLatency.cold",
        CONTROL_DIRECTOR_UX_SLOS.coldSubstantiveResponseMs,
      );
      validateLatencySample(
        value.warm,
        "localModelLatency.warm",
        CONTROL_DIRECTOR_UX_SLOS.warmSubstantiveResponseMs,
      );
      return;
    case "memory":
      if (finiteNonNegative(value.recentRecallTopK, "memory.recentRecallTopK") < 3) {
        throw new Error("memory.recentRecallTopK must be at least 3.");
      }
      requiredTrue(value.recallPassed, "memory.recallPassed");
      requiredTrue(value.provenanceVerified, "memory.provenanceVerified");
      return;
    case "delegation":
      requiredString(value.controlDirectorRunId, "delegation.controlDirectorRunId");
      requiredString(value.programManagerRunId, "delegation.programManagerRunId");
      requiredString(value.workerRunId, "delegation.workerRunId");
      requiredTrue(value.taskRootVerified, "delegation.taskRootVerified");
      requiredTrue(value.handoffVerified, "delegation.handoffVerified");
      return;
    case "judge":
      requiredString(value.receiptId, "judge.receiptId");
      requiredTrue(value.independent, "judge.independent");
      requiredTrue(value.signatureVerified, "judge.signatureVerified");
      requiredTrue(value.claimBound, "judge.claimBound");
      return;
    case "sig":
      requiredString(value.auditEventId, "sig.auditEventId");
      requiredTrue(value.ingested, "sig.ingested");
      requiredTrue(value.routed, "sig.routed");
      requiredTrue(value.backgroundEnabled, "sig.backgroundEnabled");
      return;
    case "pcc":
      requiredString(value.projectId, "pcc.projectId");
      requiredTrue(value.stateConsistent, "pcc.stateConsistent");
      requiredTrue(value.evidenceProjectionVerified, "pcc.evidenceProjectionVerified");
      return;
    case "queue":
      requiredString(value.queuedTurnId, "queue.queuedTurnId");
      requiredTrue(value.accepted, "queue.accepted");
      requiredTrue(value.processed, "queue.processed");
      requiredTrue(value.orderPreserved, "queue.orderPreserved");
      return;
    case "steer":
      requiredString(value.steerTurnId, "steer.steerTurnId");
      requiredTrue(value.accepted, "steer.accepted");
      requiredTrue(value.applied, "steer.applied");
      requiredTrue(value.activeRunPreserved, "steer.activeRunPreserved");
      return;
    case "cancel":
      requiredString(value.cancelId, "cancel.cancelId");
      requiredTrue(value.accepted, "cancel.accepted");
      requiredTrue(value.workStopped, "cancel.workStopped");
      requiredTrue(value.staleRunningCleared, "cancel.staleRunningCleared");
      return;
    case "pursueGoal":
      requiredString(value.goalId, "pursueGoal.goalId");
      requiredTrue(value.leaseObserved, "pursueGoal.leaseObserved");
      requiredTrue(value.progressObserved, "pursueGoal.progressObserved");
      requiredTrue(value.resumeVerified, "pursueGoal.resumeVerified");
      requiredTrue(value.stopVerified, "pursueGoal.stopVerified");
      return;
    case "restartRecovery":
      requiredString(value.restartId, "restartRecovery.restartId");
      requiredTrue(value.serviceHealthy, "restartRecovery.serviceHealthy");
      requiredTrue(value.goalRecovered, "restartRecovery.goalRecovered");
      requiredTrue(value.pendingTurnsRecovered, "restartRecovery.pendingTurnsRecovered");
      return;
    case "rollback":
      if (typeof value.rollbackSha !== "string" || !SHA_PATTERN.test(value.rollbackSha)) {
        throw new Error("rollback.rollbackSha must be an immutable 40-character SHA.");
      }
      requiredTrue(value.restored, "rollback.restored");
      requiredTrue(value.serviceHealthy, "rollback.serviceHealthy");
      return;
    case "liveDiagnostic":
      requiredString(value.sessionId, "liveDiagnostic.sessionId");
      requiredTrue(value.ackObserved, "liveDiagnostic.ackObserved");
      requiredTrue(value.activityObserved, "liveDiagnostic.activityObserved");
      requiredTrue(value.finalResponseReceived, "liveDiagnostic.finalResponseReceived");
      break;
    case "soak":
      break;
  }
}

function validateSurface(surface: Surface, value: JsonObject, sourceSha: string): void {
  if (value.passed !== true) {
    throw new Error(`${surface} evidence has not passed.`);
  }
  exactSha(value.sourceSha, sourceSha, surface);
  if (typeof value.checkedAt !== "string" || !Number.isFinite(Date.parse(value.checkedAt))) {
    throw new Error(`${surface} evidence requires a valid checkedAt timestamp.`);
  }
  if (strings(value.evidenceRefs).length === 0) {
    throw new Error(`${surface} evidence requires at least one evidenceRef.`);
  }
  validateSurfaceContract(surface, value);
  if (surface === "soak") {
    const durationMs = typeof value.durationMs === "number" ? value.durationMs : 0;
    if (durationMs < MINIMUM_SOAK_MS) {
      throw new Error(`soak evidence must cover at least ${MINIMUM_SOAK_MS}ms.`);
    }
    const startedAt =
      typeof value.startedAt === "string" ? Date.parse(value.startedAt) : Number.NaN;
    const endedAt = typeof value.endedAt === "string" ? Date.parse(value.endedAt) : Number.NaN;
    if (
      !Number.isFinite(startedAt) ||
      !Number.isFinite(endedAt) ||
      endedAt - startedAt < durationMs
    ) {
      throw new Error("soak evidence timestamps do not cover the claimed duration.");
    }
  }
}

export function buildControlDirectorRuntimeProof(params: {
  sourceSha: string;
  lineageReceipt: JsonObject;
  modelEval: JsonObject;
  surfaces: Record<Surface, JsonObject>;
  artifacts?: Record<string, { path: string; sha256: string }>;
  generatedAt?: string;
}): JsonObject {
  const sourceSha = params.sourceSha.trim().toLowerCase();
  if (!SHA_PATTERN.test(sourceSha)) {
    throw new Error("sourceSha must be an immutable 40-character SHA.");
  }
  const generatedAt = params.generatedAt ?? new Date().toISOString();
  const generatedAtMs = Date.parse(generatedAt);
  if (!Number.isFinite(generatedAtMs)) {
    throw new Error("generatedAt must be a valid timestamp.");
  }
  if (params.lineageReceipt.passed !== true) {
    throw new Error("lineage evidence has not passed.");
  }
  exactSha(params.lineageReceipt.sourceSha, sourceSha, "lineage");
  if (
    typeof params.lineageReceipt.checkedAt !== "string" ||
    !Number.isFinite(Date.parse(params.lineageReceipt.checkedAt))
  ) {
    throw new Error("lineage evidence requires a valid checkedAt timestamp.");
  }
  if (Date.parse(params.lineageReceipt.checkedAt as string) > generatedAtMs) {
    throw new Error("lineage evidence cannot postdate generatedAt.");
  }
  if (strings(params.lineageReceipt.evidenceRefs).length === 0) {
    throw new Error("lineage evidence requires at least one evidenceRef.");
  }
  const lineage = object(params.lineageReceipt.lineage, "lineage");
  if (lineage.status !== "ready" || lineage.sourceSha !== sourceSha) {
    throw new Error("lineage must report ready from the exact source SHA.");
  }
  if (params.modelEval.passed !== true || params.modelEval.exactRuntime !== true) {
    throw new Error("model evaluation must be an exact-runtime pass.");
  }
  exactSha(params.modelEval.sourceSha, sourceSha, "modelEval");
  if (
    typeof params.modelEval.evaluatedAt !== "string" ||
    !Number.isFinite(Date.parse(params.modelEval.evaluatedAt)) ||
    Date.parse(params.modelEval.evaluatedAt) > generatedAtMs
  ) {
    throw new Error("model evaluation requires an evaluatedAt timestamp at or before generatedAt.");
  }
  if (
    params.modelEval.passRate !== 100 ||
    params.modelEval.criticalOmissions !== 0 ||
    params.modelEval.coveragePassed !== true
  ) {
    throw new Error(
      "model evaluation requires 100% pass rate, full coverage, and zero critical omissions.",
    );
  }
  for (const surface of SURFACES) {
    validateSurface(surface, params.surfaces[surface], sourceSha);
    if (Date.parse(params.surfaces[surface].checkedAt as string) > generatedAtMs) {
      throw new Error(`${surface} evidence cannot postdate generatedAt.`);
    }
  }
  return {
    schemaVersion: 3,
    sourceSha,
    generatedAt,
    sigBackgroundEnabled: params.surfaces.sig.backgroundEnabled,
    lineage: {
      ...lineage,
      checkedAt: params.lineageReceipt.checkedAt,
      evidenceRefs: strings(params.lineageReceipt.evidenceRefs),
    },
    modelEval: params.modelEval,
    ...params.surfaces,
    artifacts: params.artifacts ?? {},
  };
}

function parseArgs(argv: string[]) {
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
  const required = ["source-sha", "lineage", "model-eval", ...SURFACES, "output"];
  for (const key of required) {
    if (!values.get(key)) {
      throw new Error(`Missing --${key}.`);
    }
  }
  return values;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const sourceSha = args.get("source-sha")!;
  const inputPaths = {
    lineage: path.resolve(args.get("lineage")!),
    modelEval: path.resolve(args.get("model-eval")!),
    ...Object.fromEntries(SURFACES.map((surface) => [surface, path.resolve(args.get(surface)!)])),
  } as Record<string, string>;
  const surfaces = Object.fromEntries(
    SURFACES.map((surface) => [surface, readJson(inputPaths[surface]!)]),
  ) as Record<Surface, JsonObject>;
  const proof = buildControlDirectorRuntimeProof({
    sourceSha,
    lineageReceipt: readJson(inputPaths.lineage!),
    modelEval: readJson(inputPaths.modelEval!),
    surfaces,
    artifacts: Object.fromEntries(
      Object.entries(inputPaths).map(([name, filePath]) => [
        name,
        { path: filePath, sha256: digest(filePath) },
      ]),
    ),
  });
  const output = path.resolve(args.get("output")!);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(proof, null, 2)}\n`, { mode: 0o600 });
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

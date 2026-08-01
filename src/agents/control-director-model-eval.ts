// Quality, latency, memory, and resource admission for Control Director model routes.
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { buildControlDirectorJudgeClaimHash } from "./control-director-contract.js";
import {
  assessControlDirectorQuality,
  booleanQualityObservation,
  buildControlDirectorLatencyObservations,
  type ControlDirectorQualityAssessment,
} from "./control-director-quality-rubric.js";
import type { IndependentJudgeReceipt } from "./independent-judge-service.js";
import { parseJudgeCompletionVerdict } from "./judge-gate.js";
import { verifyJudgeReceipt } from "./judge-receipt-signer.js";

export const CONTROL_DIRECTOR_MODEL_EVAL_VERSION = 1 as const;
export const CONTROL_DIRECTOR_MODEL_EVAL_TRIAL_RECEIPT_SCHEMA =
  "openclaw.control-director-model-eval-trial.v2" as const;

const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export type ControlDirectorEvalTaskClass =
  | "conversation"
  | "recall"
  | "planning"
  | "delegation"
  | "steering"
  | "verification";

export const CONTROL_DIRECTOR_EVAL_TASK_CLASSES: readonly ControlDirectorEvalTaskClass[] = [
  "conversation",
  "recall",
  "planning",
  "delegation",
  "steering",
  "verification",
] as const;

export type ControlDirectorModelEvalTrial = {
  trialId: string;
  modelRef: string;
  route: "local" | "codex";
  taskClass: ControlDirectorEvalTaskClass;
  cold: boolean;
  ackMs: number;
  firstActivityMs: number;
  maximumActivityGapMs: number;
  cancelAckMs: number;
  substantiveResponseMs: number;
  instructionCoveragePercent: number;
  recentRecallTop3: boolean;
  missionContinuity: boolean;
  completionProofValid: boolean;
  layoutVisible: boolean;
  peakCpuPercent: number;
  peakMemoryGb: number;
  thermalPressure: "nominal" | "fair" | "serious" | "critical" | "unknown";
  evidenceRefs: string[];
  runtimeReceipt: {
    schema: typeof CONTROL_DIRECTOR_MODEL_EVAL_TRIAL_RECEIPT_SCHEMA;
    sourceSha: string;
    configurationDigest: string;
    activeReleaseId: string;
    rollbackReleaseId: string;
    leaseOwner: string;
    approvalId: string;
    operationId: string;
    invocationId: string;
    campaignNonce: string;
    judgeAgentId: string;
    judgeReceipt: IndependentJudgeReceipt;
    capturedAt: string;
    startedAt: string;
    endedAt: string;
    telemetry: {
      path: string;
      sha256: string;
    };
    artifacts: Array<{
      evidenceRef: string;
      path: string;
      sha256: string;
    }>;
    measurementReceiptSha256: string;
    receiptSha256: string;
    publicKeyId: string;
    signature: string;
  };
};

export type ControlDirectorModelEvalTrialResult = {
  trial: ControlDirectorModelEvalTrial;
  quality: ControlDirectorQualityAssessment;
  resourcePassed: boolean;
  provenanceVerified: boolean;
  passed: boolean;
  blockers: string[];
};

export type ControlDirectorModelEvalMatrix = {
  schemaVersion: typeof CONTROL_DIRECTOR_MODEL_EVAL_VERSION;
  evaluatedAt: string;
  sourceSha?: string;
  configurationDigest?: string;
  modelRef?: string;
  modelIdentity?: { modelDigest: string; cacheDigest: string };
  trialReceiptSetDigest?: string;
  exactRuntime: boolean;
  passed: boolean;
  passRate: number;
  criticalOmissions: number;
  coveragePassed: boolean;
  coverageBlockers: string[];
  results: ControlDirectorModelEvalTrialResult[];
  admittedModels: string[];
  rejectedModels: string[];
};

const MAX_CPU_PERCENT = 800;
// A 36GB estimated Q8 model gets 12GB process/runtime headroom; host reserve is
// enforced separately by the live resource governor.
const MAX_MEMORY_GB = 48;
const MAX_LATENCY_MS = 60 * 60 * 1_000;
const MAX_REPORTED_CPU_PERCENT = 10_000;
const MAX_REPORTED_MEMORY_GB = 1_024;
const SAFE_TRIAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const CERTIFICATION_LEASE_STATES = new Set(["acquired", "promotion-authorized", "promoted"]);

const TASK_CLASSES = new Set<ControlDirectorEvalTaskClass>(CONTROL_DIRECTOR_EVAL_TASK_CLASSES);
const THERMAL_PRESSURES = new Set<ControlDirectorModelEvalTrial["thermalPressure"]>([
  "nominal",
  "fair",
  "serious",
  "critical",
  "unknown",
]);

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function requiredTrialId(value: unknown, field: string): string {
  const normalized = requiredString(value, field);
  if (!SAFE_TRIAL_ID_PATTERN.test(normalized)) {
    throw new Error(`${field} must use 1-128 prompt-safe identifier characters.`);
  }
  return normalized;
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be a boolean.`);
  }
  return value;
}

function boundedNumber(value: unknown, field: string, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > maximum) {
    throw new Error(`${field} must be a finite number from 0 through ${maximum}.`);
  }
  return value;
}

function parseEvidenceRefs(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array of evidence references.`);
  }
  const refs = value.map((entry, index) => requiredString(entry, `${field}[${index}]`));
  if (refs.length === 0 || new Set(refs).size !== refs.length) {
    throw new Error(`${field} must contain unique evidence references.`);
  }
  return refs;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeJudgeVerdictForVerification(value: string): IndependentJudgeReceipt["verdict"] {
  return value === "APPROVE" ||
    value === "REJECT" ||
    value === "REQUEST_MORE_EVIDENCE" ||
    value === "ESCALATE_TO_HUMAN"
    ? value
    : "REQUEST_MORE_EVIDENCE";
}

function requiredDigest(value: unknown, field: string): string {
  const normalized = requiredString(value, field).toLowerCase();
  if (!SHA256_PATTERN.test(normalized)) {
    throw new Error(`${field} must be a 64-character SHA-256 digest.`);
  }
  return normalized;
}

function requiredRelativePath(value: unknown, field: string): string {
  const normalized = requiredString(value, field).replaceAll("\\", "/");
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//u.test(normalized) ||
    normalized.split("/").includes("..")
  ) {
    throw new Error(`${field} must be a contained relative artifact path.`);
  }
  return normalized;
}

function requiredDate(value: unknown, field: string): string {
  const normalized = requiredString(value, field);
  if (!Number.isFinite(Date.parse(normalized))) {
    throw new Error(`${field} must be a valid timestamp.`);
  }
  return normalized;
}

function parseRuntimeReceipt(
  value: unknown,
  field: string,
  evidenceRefs: readonly string[],
): ControlDirectorModelEvalTrial["runtimeReceipt"] {
  const record = object(value);
  if (!record) {
    throw new Error(`${field} must be a JSON object.`);
  }
  if (record.schema !== CONTROL_DIRECTOR_MODEL_EVAL_TRIAL_RECEIPT_SCHEMA) {
    throw new Error(`${field}.schema is not supported.`);
  }
  const sourceSha = requiredString(record.sourceSha, `${field}.sourceSha`).toLowerCase();
  if (!SHA_PATTERN.test(sourceSha)) {
    throw new Error(`${field}.sourceSha must be an immutable 40-character SHA.`);
  }
  const startedAt = requiredDate(record.startedAt, `${field}.startedAt`);
  const endedAt = requiredDate(record.endedAt, `${field}.endedAt`);
  const capturedAt = requiredDate(record.capturedAt, `${field}.capturedAt`);
  if (Date.parse(endedAt) < Date.parse(startedAt) || Date.parse(capturedAt) < Date.parse(endedAt)) {
    throw new Error(`${field} must satisfy startedAt <= endedAt <= capturedAt.`);
  }
  const judgeReceipt = object(record.judgeReceipt);
  if (!judgeReceipt) {
    throw new Error(`${field}.judgeReceipt must be a JSON object.`);
  }
  const telemetryRecord = object(record.telemetry);
  if (!telemetryRecord) {
    throw new Error(`${field}.telemetry must be a JSON object.`);
  }
  const artifactsValue = record.artifacts;
  if (!Array.isArray(artifactsValue) || artifactsValue.length === 0) {
    throw new Error(`${field}.artifacts must be a non-empty array.`);
  }
  const artifacts = artifactsValue.map((entry, index) => {
    const artifact = object(entry);
    if (!artifact) {
      throw new Error(`${field}.artifacts[${index}] must be a JSON object.`);
    }
    return {
      evidenceRef: requiredString(artifact.evidenceRef, `${field}.artifacts[${index}].evidenceRef`),
      path: requiredRelativePath(artifact.path, `${field}.artifacts[${index}].path`),
      sha256: requiredDigest(artifact.sha256, `${field}.artifacts[${index}].sha256`),
    };
  });
  const artifactEvidenceRefs = artifacts.map((entry) => entry.evidenceRef);
  if (
    new Set(artifactEvidenceRefs).size !== artifactEvidenceRefs.length ||
    [...artifactEvidenceRefs].toSorted().join("\n") !== [...evidenceRefs].toSorted().join("\n")
  ) {
    throw new Error(`${field}.artifacts must bind every trial evidenceRef exactly once.`);
  }
  return {
    schema: CONTROL_DIRECTOR_MODEL_EVAL_TRIAL_RECEIPT_SCHEMA,
    sourceSha,
    configurationDigest: requiredDigest(record.configurationDigest, `${field}.configurationDigest`),
    activeReleaseId: requiredString(record.activeReleaseId, `${field}.activeReleaseId`),
    rollbackReleaseId: requiredString(record.rollbackReleaseId, `${field}.rollbackReleaseId`),
    leaseOwner: requiredString(record.leaseOwner, `${field}.leaseOwner`),
    approvalId: requiredString(record.approvalId, `${field}.approvalId`),
    operationId: requiredString(record.operationId, `${field}.operationId`),
    invocationId: requiredString(record.invocationId, `${field}.invocationId`),
    campaignNonce: requiredDigest(record.campaignNonce, `${field}.campaignNonce`),
    judgeAgentId: requiredString(record.judgeAgentId, `${field}.judgeAgentId`),
    judgeReceipt: judgeReceipt as IndependentJudgeReceipt,
    capturedAt,
    startedAt,
    endedAt,
    telemetry: {
      path: requiredRelativePath(telemetryRecord.path, `${field}.telemetry.path`),
      sha256: requiredDigest(telemetryRecord.sha256, `${field}.telemetry.sha256`),
    },
    artifacts,
    measurementReceiptSha256: requiredDigest(
      record.measurementReceiptSha256,
      `${field}.measurementReceiptSha256`,
    ),
    receiptSha256: requiredDigest(record.receiptSha256, `${field}.receiptSha256`),
    publicKeyId: requiredDigest(record.publicKeyId, `${field}.publicKeyId`),
    signature: requiredString(record.signature, `${field}.signature`),
  };
}

function canonicalTrialMeasurement(
  trial: Omit<ControlDirectorModelEvalTrial, "runtimeReceipt">,
  receipt: Omit<
    ControlDirectorModelEvalTrial["runtimeReceipt"],
    "judgeReceipt" | "measurementReceiptSha256" | "receiptSha256" | "signature" | "publicKeyId"
  >,
) {
  return {
    schema: receipt.schema,
    sourceSha: receipt.sourceSha,
    configurationDigest: receipt.configurationDigest,
    activeReleaseId: receipt.activeReleaseId,
    rollbackReleaseId: receipt.rollbackReleaseId,
    leaseOwner: receipt.leaseOwner,
    approvalId: receipt.approvalId,
    operationId: receipt.operationId,
    invocationId: receipt.invocationId,
    campaignNonce: receipt.campaignNonce,
    judgeAgentId: receipt.judgeAgentId,
    capturedAt: receipt.capturedAt,
    trial: {
      trialId: trial.trialId,
      modelRef: trial.modelRef,
      route: trial.route,
      taskClass: trial.taskClass,
      cold: trial.cold,
      ackMs: trial.ackMs,
      firstActivityMs: trial.firstActivityMs,
      maximumActivityGapMs: trial.maximumActivityGapMs,
      cancelAckMs: trial.cancelAckMs,
      substantiveResponseMs: trial.substantiveResponseMs,
      instructionCoveragePercent: trial.instructionCoveragePercent,
      recentRecallTop3: trial.recentRecallTop3,
      missionContinuity: trial.missionContinuity,
      completionProofValid: trial.completionProofValid,
      layoutVisible: trial.layoutVisible,
      peakCpuPercent: trial.peakCpuPercent,
      peakMemoryGb: trial.peakMemoryGb,
      thermalPressure: trial.thermalPressure,
      evidenceRefs: [...trial.evidenceRefs].toSorted(),
    },
    startedAt: receipt.startedAt,
    endedAt: receipt.endedAt,
    telemetry: receipt.telemetry,
    artifacts: [...receipt.artifacts].toSorted((left, right) =>
      left.evidenceRef.localeCompare(right.evidenceRef),
    ),
  };
}

function canonicalTrialReceipt(
  trial: Omit<ControlDirectorModelEvalTrial, "runtimeReceipt">,
  receipt: Omit<
    ControlDirectorModelEvalTrial["runtimeReceipt"],
    "receiptSha256" | "signature" | "publicKeyId"
  >,
) {
  const { judgeReceipt, measurementReceiptSha256, ...measurementReceipt } = receipt;
  return {
    ...canonicalTrialMeasurement(trial, measurementReceipt),
    measurementReceiptSha256,
    judgeReceipt,
  };
}

export function buildControlDirectorModelEvalTrialSignedPayload(
  trial: Omit<ControlDirectorModelEvalTrial, "runtimeReceipt">,
  receipt: Omit<ControlDirectorModelEvalTrial["runtimeReceipt"], "signature" | "publicKeyId">,
): Record<string, unknown> {
  const { receiptSha256, ...receiptWithoutDigest } = receipt;
  return {
    ...canonicalTrialReceipt(trial, receiptWithoutDigest),
    receiptSha256,
  };
}

export function digestControlDirectorModelEvalTrialReceipt(
  trial: Omit<ControlDirectorModelEvalTrial, "runtimeReceipt">,
  receipt: Omit<
    ControlDirectorModelEvalTrial["runtimeReceipt"],
    "receiptSha256" | "signature" | "publicKeyId"
  >,
): string {
  return digest(canonicalTrialReceipt(trial, receipt));
}

export function digestControlDirectorModelEvalTrialMeasurementReceipt(
  trial: Omit<ControlDirectorModelEvalTrial, "runtimeReceipt">,
  receipt: Omit<
    ControlDirectorModelEvalTrial["runtimeReceipt"],
    "judgeReceipt" | "measurementReceiptSha256" | "receiptSha256" | "signature" | "publicKeyId"
  >,
): string {
  return digest(canonicalTrialMeasurement(trial, receipt));
}

export function buildControlDirectorModelEvalCampaignNonce(params: {
  sourceSha: string;
  activeReleaseId: string;
  invocationId: string;
}): string {
  return digest({
    sourceSha: params.sourceSha,
    activeReleaseId: params.activeReleaseId,
    invocationId: params.invocationId,
  });
}

export function buildControlDirectorModelTrialJudgeClaim(params: {
  trial: Omit<ControlDirectorModelEvalTrial, "runtimeReceipt">;
  campaignNonce: string;
  receiptSha256: string;
}) {
  const trial = params.trial;
  const missionId = `control-director-model-eval:${params.campaignNonce}:${trial.trialId}`;
  const requestBody =
    `Independently judge exact-runtime Control Director model trial ${trial.trialId}. ` +
    "Approve only if every supplied latency, quality, continuity, proof, layout, resource, and thermal measurement supports the claimed pass.";
  const finalText = `Trial ${trial.trialId} passed with measurement receipt ${params.receiptSha256}.`;
  const evidenceSummary = `Bound exact-runtime trial: ${JSON.stringify({
    trialId: trial.trialId,
    modelRef: trial.modelRef,
    route: trial.route,
    taskClass: trial.taskClass,
    cold: trial.cold,
    ackMs: trial.ackMs,
    firstActivityMs: trial.firstActivityMs,
    maximumActivityGapMs: trial.maximumActivityGapMs,
    cancelAckMs: trial.cancelAckMs,
    substantiveResponseMs: trial.substantiveResponseMs,
    instructionCoveragePercent: trial.instructionCoveragePercent,
    recentRecallTop3: trial.recentRecallTop3,
    missionContinuity: trial.missionContinuity,
    completionProofValid: trial.completionProofValid,
    layoutVisible: trial.layoutVisible,
    peakCpuPercent: trial.peakCpuPercent,
    peakMemoryGb: trial.peakMemoryGb,
    thermalPressure: trial.thermalPressure,
    evidenceRefs: [...trial.evidenceRefs].toSorted(),
  })}.`;
  const artifactIds = [...trial.evidenceRefs].toSorted();
  return { missionId, requestBody, finalText, evidenceSummary, artifactIds };
}

const CONTROL_DIRECTOR_MODEL_TRIAL_MEASUREMENT_FIELDS = [
  "ackMs",
  "firstActivityMs",
  "maximumActivityGapMs",
  "cancelAckMs",
  "substantiveResponseMs",
  "instructionCoveragePercent",
  "recentRecallTop3",
  "missionContinuity",
  "completionProofValid",
  "layoutVisible",
  "peakCpuPercent",
  "peakMemoryGb",
  "thermalPressure",
] as const;

export function digestControlDirectorModelTrialMeasurementSet(
  trial: Omit<ControlDirectorModelEvalTrial, "runtimeReceipt">,
): string {
  return digest(
    Object.fromEntries(
      CONTROL_DIRECTOR_MODEL_TRIAL_MEASUREMENT_FIELDS.map((field) => [field, trial[field]]),
    ),
  );
}

export function digestControlDirectorModelTrialEvidenceSet(
  artifacts: readonly ControlDirectorModelEvalTrial["runtimeReceipt"]["artifacts"][number][],
): string {
  return digest(
    [...artifacts]
      .toSorted((left, right) => left.evidenceRef.localeCompare(right.evidenceRef))
      .map(({ evidenceRef, path, sha256 }) => ({ evidenceRef, path, sha256 })),
  );
}

/** Parse untrusted runtime-trial JSON before it can influence admission. */
export function parseControlDirectorModelEvalTrials(
  value: unknown,
): ControlDirectorModelEvalTrial[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Model evaluation input must be a non-empty JSON array.");
  }
  const seenTrialIds = new Set<string>();
  return value.map((entry, index) => {
    const record = object(entry);
    if (!record) {
      throw new Error(`trials[${index}] must be a JSON object.`);
    }
    const prefix = `trials[${index}]`;
    const trialId = requiredTrialId(record.trialId, `${prefix}.trialId`);
    if (seenTrialIds.has(trialId)) {
      throw new Error(`Duplicate model-evaluation trialId: ${trialId}.`);
    }
    seenTrialIds.add(trialId);
    const route = requiredString(record.route, `${prefix}.route`);
    if (route !== "local" && route !== "codex") {
      throw new Error(`${prefix}.route must be local or codex.`);
    }
    const taskClass = requiredString(record.taskClass, `${prefix}.taskClass`);
    if (!TASK_CLASSES.has(taskClass as ControlDirectorEvalTaskClass)) {
      throw new Error(`${prefix}.taskClass is not admitted.`);
    }
    const thermalPressure = requiredString(record.thermalPressure, `${prefix}.thermalPressure`);
    if (
      !THERMAL_PRESSURES.has(thermalPressure as ControlDirectorModelEvalTrial["thermalPressure"])
    ) {
      throw new Error(`${prefix}.thermalPressure is not admitted.`);
    }
    const evidenceRefs = parseEvidenceRefs(record.evidenceRefs, `${prefix}.evidenceRefs`);
    const trialWithoutReceipt: Omit<ControlDirectorModelEvalTrial, "runtimeReceipt"> = {
      trialId,
      modelRef: requiredString(record.modelRef, `${prefix}.modelRef`),
      route: route as ControlDirectorModelEvalTrial["route"],
      taskClass: taskClass as ControlDirectorEvalTaskClass,
      cold: requiredBoolean(record.cold, `${prefix}.cold`),
      ackMs: boundedNumber(record.ackMs, `${prefix}.ackMs`, MAX_LATENCY_MS),
      firstActivityMs: boundedNumber(
        record.firstActivityMs,
        `${prefix}.firstActivityMs`,
        MAX_LATENCY_MS,
      ),
      maximumActivityGapMs: boundedNumber(
        record.maximumActivityGapMs,
        `${prefix}.maximumActivityGapMs`,
        MAX_LATENCY_MS,
      ),
      cancelAckMs: boundedNumber(record.cancelAckMs, `${prefix}.cancelAckMs`, MAX_LATENCY_MS),
      substantiveResponseMs: boundedNumber(
        record.substantiveResponseMs,
        `${prefix}.substantiveResponseMs`,
        MAX_LATENCY_MS,
      ),
      instructionCoveragePercent: boundedNumber(
        record.instructionCoveragePercent,
        `${prefix}.instructionCoveragePercent`,
        100,
      ),
      recentRecallTop3: requiredBoolean(record.recentRecallTop3, `${prefix}.recentRecallTop3`),
      missionContinuity: requiredBoolean(record.missionContinuity, `${prefix}.missionContinuity`),
      completionProofValid: requiredBoolean(
        record.completionProofValid,
        `${prefix}.completionProofValid`,
      ),
      layoutVisible: requiredBoolean(record.layoutVisible, `${prefix}.layoutVisible`),
      peakCpuPercent: boundedNumber(
        record.peakCpuPercent,
        `${prefix}.peakCpuPercent`,
        MAX_REPORTED_CPU_PERCENT,
      ),
      peakMemoryGb: boundedNumber(
        record.peakMemoryGb,
        `${prefix}.peakMemoryGb`,
        MAX_REPORTED_MEMORY_GB,
      ),
      thermalPressure: thermalPressure as ControlDirectorModelEvalTrial["thermalPressure"],
      evidenceRefs,
    };
    return {
      ...trialWithoutReceipt,
      runtimeReceipt: parseRuntimeReceipt(
        record.runtimeReceipt,
        `${prefix}.runtimeReceipt`,
        evidenceRefs,
      ),
    };
  });
}

function evidence(trial: ControlDirectorModelEvalTrial, suffix: string): string {
  return trial.evidenceRefs.find((ref) => ref.startsWith(`${suffix}:`)) ?? "";
}

function trialEvidenceBlockers(trial: ControlDirectorModelEvalTrial): string[] {
  const required = ["latency", "coverage", "mission", "layout", "resource"];
  if (trial.taskClass === "recall") {
    required.push("recall");
  }
  if (trial.taskClass === "verification") {
    required.push("judge");
  }
  return required.flatMap((kind) =>
    evidence(trial, kind) ? [] : [`missing ${kind}: exact-runtime evidence reference`],
  );
}

export type ControlDirectorModelEvalArtifactVerifier = (artifact: {
  path: string;
  sha256: string;
}) => boolean;
export type ControlDirectorModelEvalArtifactReader = (artifact: {
  path: string;
  sha256: string;
}) => string | undefined;

function jsonPointerValue(value: unknown, pointer: string): unknown {
  if (!pointer.startsWith("/")) {
    return undefined;
  }
  return pointer
    .slice(1)
    .split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce<unknown>((current, part) => {
      if (!current || typeof current !== "object") {
        return undefined;
      }
      return (current as Record<string, unknown>)[part];
    }, value);
}

function trialJudgeIssuanceBlockers(params: {
  trial: ControlDirectorModelEvalTrial;
  trialWithoutReceipt: Omit<ControlDirectorModelEvalTrial, "runtimeReceipt">;
  judgeClaim: ReturnType<typeof buildControlDirectorModelTrialJudgeClaim>;
  expected?: {
    modelIdentity?: { modelDigest: string; cacheDigest: string };
    verifyArtifact?: ControlDirectorModelEvalArtifactVerifier;
    readArtifact?: ControlDirectorModelEvalArtifactReader;
  };
}): string[] {
  const issuance = params.trial.runtimeReceipt.judgeReceipt.trialIssuance;
  const artifactsByEvidenceRef = new Map(
    params.trial.runtimeReceipt.artifacts.map((artifact) => [artifact.evidenceRef, artifact]),
  );
  if (
    !issuance ||
    issuance.schema !== "openclaw.control-director-trial-judge-issuance.v1" ||
    issuance.purpose !== "control-director-model-trial" ||
    issuance.campaignNonce !== params.trial.runtimeReceipt.campaignNonce ||
    issuance.trialId !== params.trial.trialId ||
    issuance.trialModelRef !== params.trial.modelRef ||
    !SHA256_PATTERN.test(issuance.trialModelIdentity?.modelDigest ?? "") ||
    !SHA256_PATTERN.test(issuance.trialModelIdentity?.cacheDigest ?? "") ||
    !SHA256_PATTERN.test(issuance.judgeModelIdentity?.modelDigest ?? "") ||
    !SHA256_PATTERN.test(issuance.judgeModelIdentity?.cacheDigest ?? "") ||
    issuance.trialModelIdentity.modelDigest === issuance.judgeModelIdentity.modelDigest ||
    issuance.trialModelIdentity.cacheDigest === issuance.judgeModelIdentity.cacheDigest ||
    (params.expected?.modelIdentity !== undefined &&
      !isDeepStrictEqual(issuance.trialModelIdentity, params.expected.modelIdentity)) ||
    issuance.measurementReceiptSha256 !== params.trial.runtimeReceipt.measurementReceiptSha256 ||
    issuance.measurementSetSha256 !==
      digestControlDirectorModelTrialMeasurementSet(params.trialWithoutReceipt) ||
    issuance.evidenceSetSha256 !==
      digestControlDirectorModelTrialEvidenceSet(params.trial.runtimeReceipt.artifacts) ||
    !issuance.certificationLease ||
    issuance.certificationLease.schema !== "openclaw.custom-runtime-certification-lease.v2" ||
    !issuance.certificationLease.runtimeHome ||
    !CERTIFICATION_LEASE_STATES.has(issuance.certificationLease.state) ||
    issuance.certificationLease.operationClass !== "release-certification" ||
    issuance.certificationLease.activeSha !== params.trial.runtimeReceipt.sourceSha ||
    issuance.certificationLease.candidateSha !== params.trial.runtimeReceipt.sourceSha ||
    !SHA_PATTERN.test(issuance.certificationLease.rollbackSha) ||
    issuance.certificationLease.rollbackSha === params.trial.runtimeReceipt.sourceSha ||
    issuance.certificationLease.activeReleaseId !== params.trial.runtimeReceipt.activeReleaseId ||
    issuance.certificationLease.rollbackReleaseId !==
      params.trial.runtimeReceipt.rollbackReleaseId ||
    issuance.certificationLease.owner !== params.trial.runtimeReceipt.leaseOwner ||
    issuance.certificationLease.approvalId !== params.trial.runtimeReceipt.approvalId ||
    issuance.certificationLease.operationId !== params.trial.runtimeReceipt.operationId ||
    issuance.certificationLease.invocationId !== params.trial.runtimeReceipt.invocationId ||
    !SHA256_PATTERN.test(issuance.certificationLease.observedLeaseSha256) ||
    !SHA256_PATTERN.test(issuance.certificationLease.epochSha256) ||
    !issuance.certificationLease.actor ||
    !issuance.certificationLease.heartbeatRequired ||
    !Number.isInteger(issuance.certificationLease.heartbeatSequence) ||
    issuance.certificationLease.heartbeatSequence < 0 ||
    !Number.isInteger(issuance.certificationLease.pid) ||
    issuance.certificationLease.pid <= 0 ||
    !issuance.transcript ||
    typeof issuance.transcript.path !== "string" ||
    !issuance.transcript.path ||
    typeof issuance.transcript.sha256 !== "string" ||
    typeof issuance.transcript.content !== "string" ||
    !SHA256_PATTERN.test(issuance.transcript.sha256) ||
    sha256Text(issuance.transcript.content) !== issuance.transcript.sha256 ||
    !issuance.invocation ||
    !issuance.parsing ||
    !Array.isArray(issuance.measurementSources) ||
    !Array.isArray(issuance.evidenceArtifacts) ||
    !params.expected?.verifyArtifact?.(issuance.transcript)
  ) {
    return ["runtime trial lacks a transcript-bound Judge-only issuance"];
  }
  const measurementSources = issuance.measurementSources;
  const evidenceArtifacts = issuance.evidenceArtifacts;
  if (
    measurementSources.length !== CONTROL_DIRECTOR_MODEL_TRIAL_MEASUREMENT_FIELDS.length ||
    measurementSources.some(
      (source) =>
        !source ||
        typeof source.metric !== "string" ||
        typeof source.evidenceRef !== "string" ||
        typeof source.artifactSha256 !== "string" ||
        typeof source.jsonPointer !== "string" ||
        typeof source.valueSha256 !== "string",
    ) ||
    new Set(measurementSources.map((source) => source.metric)).size !== measurementSources.length ||
    evidenceArtifacts.length !== params.trial.runtimeReceipt.artifacts.length ||
    evidenceArtifacts.some(
      (artifact) =>
        !artifact ||
        typeof artifact.evidenceRef !== "string" ||
        typeof artifact.path !== "string" ||
        typeof artifact.sha256 !== "string" ||
        typeof artifact.content !== "string",
    ) ||
    new Set(evidenceArtifacts.map((artifact) => artifact.evidenceRef)).size !==
      evidenceArtifacts.length
  ) {
    return ["runtime trial Judge issuance does not bind every measured value"];
  }
  for (const artifact of params.trial.runtimeReceipt.artifacts) {
    const signedArtifact = evidenceArtifacts.find(
      (candidate) => candidate.evidenceRef === artifact.evidenceRef,
    );
    if (
      !signedArtifact ||
      signedArtifact.path !== artifact.path ||
      signedArtifact.sha256 !== artifact.sha256 ||
      sha256Text(signedArtifact.content) !== artifact.sha256 ||
      !params.expected?.verifyArtifact?.(artifact)
    ) {
      return ["runtime trial Judge issuance evidence artifacts are invalid"];
    }
  }
  for (const field of CONTROL_DIRECTOR_MODEL_TRIAL_MEASUREMENT_FIELDS) {
    const source = measurementSources.find((entry) => entry.metric === field);
    const artifact = source ? artifactsByEvidenceRef.get(source.evidenceRef) : undefined;
    const signedArtifact = source
      ? evidenceArtifacts.find((entry) => entry.evidenceRef === source.evidenceRef)
      : undefined;
    if (
      !source ||
      !artifact ||
      !signedArtifact ||
      source.artifactSha256 !== artifact.sha256 ||
      source.jsonPointer !== `/trial/${field}` ||
      source.valueSha256 !== digest(params.trialWithoutReceipt[field])
    ) {
      return ["runtime trial Judge issuance measurement provenance is invalid"];
    }
    const artifactText = params.expected?.readArtifact?.(artifact) ?? signedArtifact.content;
    try {
      if (
        !artifactText ||
        !isDeepStrictEqual(
          jsonPointerValue(JSON.parse(artifactText), source.jsonPointer),
          params.trialWithoutReceipt[field],
        )
      ) {
        return ["runtime trial measured values do not replay from evidence artifacts"];
      }
    } catch {
      return ["runtime trial measured values do not replay from evidence artifacts"];
    }
  }
  const transcriptText =
    params.expected?.readArtifact?.(issuance.transcript) ?? issuance.transcript.content;
  if (!transcriptText) {
    return ["runtime trial Judge invocation transcript failed digest verification"];
  }
  try {
    const transcript = JSON.parse(transcriptText) as Record<string, unknown>;
    const invocation = object(transcript.invocation);
    const signedInvocation = issuance.invocation;
    const prompt = typeof transcript.prompt === "string" ? transcript.prompt : undefined;
    const finalPrompt =
      typeof transcript.finalPrompt === "string" ? transcript.finalPrompt : undefined;
    const rawOutput = typeof transcript.rawOutput === "string" ? transcript.rawOutput : undefined;
    if (prompt === undefined || finalPrompt === undefined || rawOutput === undefined) {
      return ["runtime trial Judge invocation transcript does not replay"];
    }
    const parsed = parseJudgeCompletionVerdict(rawOutput);
    if (
      transcript.schema !== "openclaw.control-director-trial-judge-transcript.v1" ||
      !isDeepStrictEqual(transcript.claim, params.judgeClaim) ||
      transcript.claimHash !== params.trial.runtimeReceipt.judgeReceipt.claimHash ||
      transcript.measurementReceiptSha256 !== issuance.measurementReceiptSha256 ||
      !isDeepStrictEqual(transcript.trialModelIdentity, issuance.trialModelIdentity) ||
      !isDeepStrictEqual(transcript.judgeModelIdentity, issuance.judgeModelIdentity) ||
      transcript.measurementSetSha256 !== issuance.measurementSetSha256 ||
      transcript.evidenceSetSha256 !== issuance.evidenceSetSha256 ||
      !isDeepStrictEqual(transcript.certificationLease, issuance.certificationLease) ||
      !isDeepStrictEqual(transcript.measurementSources, issuance.measurementSources) ||
      !isDeepStrictEqual(transcript.evidenceArtifacts, issuance.evidenceArtifacts) ||
      !invocation ||
      invocation.runId !== signedInvocation.runId ||
      invocation.sessionId !== signedInvocation.sessionId ||
      invocation.judgeAgentId !== signedInvocation.judgeAgentId ||
      invocation.provider !== signedInvocation.provider ||
      invocation.model !== signedInvocation.model ||
      invocation.startedAt !== signedInvocation.startedAt ||
      invocation.endedAt !== signedInvocation.endedAt ||
      invocation.stopReason !== signedInvocation.stopReason ||
      sha256Text(prompt) !== signedInvocation.requestPromptSha256 ||
      sha256Text(finalPrompt) !== signedInvocation.finalPromptSha256 ||
      sha256Text(rawOutput) !== signedInvocation.rawOutputSha256 ||
      parsed.status !== "parsed" ||
      issuance.parsing.status !== "parsed" ||
      issuance.parsing.parser !== "judge-six-line-v1" ||
      normalizeJudgeVerdictForVerification(parsed.verdict) !== issuance.parsing.verdict ||
      sha256Text(JSON.stringify(parsed)) !== issuance.parsing.parsedVerdictSha256 ||
      `${signedInvocation.provider}/${signedInvocation.model}` !==
        params.trial.runtimeReceipt.judgeReceipt.model ||
      signedInvocation.judgeAgentId !== params.trial.runtimeReceipt.judgeAgentId ||
      signedInvocation.runId !== params.trial.runtimeReceipt.judgeReceipt.judgeRunId
    ) {
      return ["runtime trial Judge invocation transcript does not replay"];
    }
  } catch {
    return ["runtime trial Judge invocation transcript does not replay"];
  }
  return [];
}

function trialProvenanceBlockers(
  trial: ControlDirectorModelEvalTrial,
  expected?: {
    modelIdentity?: { modelDigest: string; cacheDigest: string };
    sourceSha?: string;
    configurationDigest?: string;
    modelRef?: string;
    activeReleaseId?: string;
    rollbackReleaseId?: string;
    leaseOwner?: string;
    approvalId?: string;
    operationId?: string;
    invocationId?: string;
    judgeAgentId?: string;
    judgePublicKeyPem?: string;
    judgePublicKeyId?: string;
    leaseAcquiredAt?: string;
    evaluatedAt?: string;
    verifyArtifact?: ControlDirectorModelEvalArtifactVerifier;
    readArtifact?: ControlDirectorModelEvalArtifactReader;
  },
): string[] {
  const {
    receiptSha256: _receiptSha256,
    signature: _signature,
    publicKeyId: _publicKeyId,
    ...receiptWithoutDigest
  } = trial.runtimeReceipt;
  const { runtimeReceipt: _runtimeReceipt, ...trialWithoutReceipt } = trial;
  const blockers: string[] = [];
  if (
    trial.runtimeReceipt.receiptSha256 !==
    digestControlDirectorModelEvalTrialReceipt(trialWithoutReceipt, receiptWithoutDigest)
  ) {
    blockers.push("runtime receipt digest does not bind the trial");
  }
  const {
    judgeReceipt: _judgeReceipt,
    measurementReceiptSha256: _measurementReceiptSha256,
    ...measurementReceipt
  } = receiptWithoutDigest;
  if (
    trial.runtimeReceipt.measurementReceiptSha256 !==
    digestControlDirectorModelEvalTrialMeasurementReceipt(trialWithoutReceipt, measurementReceipt)
  ) {
    blockers.push("runtime measurement receipt digest does not bind the trial");
  }
  if (expected?.sourceSha && trial.runtimeReceipt.sourceSha !== expected.sourceSha) {
    blockers.push("runtime receipt source SHA does not match the certification candidate");
  }
  if (
    expected?.configurationDigest &&
    trial.runtimeReceipt.configurationDigest !== expected.configurationDigest
  ) {
    blockers.push("runtime receipt configuration digest does not match");
  }
  if (expected?.modelRef && trial.modelRef !== expected.modelRef) {
    blockers.push("runtime receipt model does not match the selected model");
  }
  for (const [field, expectedValue] of Object.entries({
    activeReleaseId: expected?.activeReleaseId,
    rollbackReleaseId: expected?.rollbackReleaseId,
    leaseOwner: expected?.leaseOwner,
    approvalId: expected?.approvalId,
    operationId: expected?.operationId,
    invocationId: expected?.invocationId,
    judgeAgentId: expected?.judgeAgentId,
  })) {
    if (
      expectedValue &&
      trial.runtimeReceipt[field as keyof typeof trial.runtimeReceipt] !== expectedValue
    ) {
      blockers.push(`runtime receipt ${field} does not match certification authorization`);
    }
  }
  if (expected?.sourceSha && expected.activeReleaseId && expected.invocationId) {
    const expectedCampaignNonce = buildControlDirectorModelEvalCampaignNonce({
      sourceSha: expected.sourceSha,
      activeReleaseId: expected.activeReleaseId,
      invocationId: expected.invocationId,
    });
    if (trial.runtimeReceipt.campaignNonce !== expectedCampaignNonce) {
      blockers.push("runtime receipt campaign nonce does not match certification authorization");
    }
  }
  const judgeClaim = buildControlDirectorModelTrialJudgeClaim({
    trial: trialWithoutReceipt,
    campaignNonce: trial.runtimeReceipt.campaignNonce,
    receiptSha256: trial.runtimeReceipt.measurementReceiptSha256,
  });
  const judgeReceipt = trial.runtimeReceipt.judgeReceipt;
  const expectedJudgeClaimHash = buildControlDirectorJudgeClaimHash(judgeClaim);
  if (
    judgeReceipt.schemaVersion !== 1 ||
    judgeReceipt.missionId !== judgeClaim.missionId ||
    judgeReceipt.claimHash !== expectedJudgeClaimHash ||
    judgeReceipt.verdict !== "APPROVE" ||
    judgeReceipt.judgeAgentId !== expected?.judgeAgentId ||
    !judgeReceipt.receiptId?.trim() ||
    !judgeReceipt.judgeRunId?.trim() ||
    judgeReceipt.judgeRunId === "not-run" ||
    !judgeReceipt.model?.includes("/") ||
    judgeReceipt.model === trial.modelRef ||
    !expected?.judgePublicKeyPem ||
    !expected?.judgePublicKeyId ||
    judgeReceipt.publicKeyId !== expected.judgePublicKeyId ||
    !verifyJudgeReceipt(judgeReceipt, {
      publicKeyPem: expected.judgePublicKeyPem,
      certificationAt: expected.evaluatedAt,
    })
  ) {
    blockers.push("runtime trial lacks an independent claim-bound Judge approval");
  }
  blockers.push(
    ...trialJudgeIssuanceBlockers({
      trial,
      trialWithoutReceipt,
      judgeClaim,
      expected,
    }),
  );
  const startedAtMs = Date.parse(trial.runtimeReceipt.startedAt);
  const endedAtMs = Date.parse(trial.runtimeReceipt.endedAt);
  const capturedAtMs = Date.parse(trial.runtimeReceipt.capturedAt);
  const leaseAcquiredAtMs = Date.parse(expected?.leaseAcquiredAt ?? "");
  const evaluatedAtMs = Date.parse(expected?.evaluatedAt ?? "");
  const leaseExpiresAtMs = Date.parse(
    judgeReceipt.trialIssuance?.certificationLease?.expiresAt ?? "",
  );
  const boundLeaseCreatedAtMs = Date.parse(
    judgeReceipt.trialIssuance?.certificationLease?.createdAt ?? "",
  );
  const boundLeaseHeartbeatAtMs = Date.parse(
    judgeReceipt.trialIssuance?.certificationLease?.heartbeatAt ?? "",
  );
  const judgeInvocation = judgeReceipt.trialIssuance?.invocation;
  const judgeStartedAtMs = Date.parse(judgeInvocation?.startedAt ?? "");
  const judgeEndedAtMs = Date.parse(judgeInvocation?.endedAt ?? "");
  if (
    !Number.isFinite(leaseAcquiredAtMs) ||
    !Number.isFinite(evaluatedAtMs) ||
    !Number.isFinite(leaseExpiresAtMs) ||
    !Number.isFinite(boundLeaseCreatedAtMs) ||
    !Number.isFinite(boundLeaseHeartbeatAtMs) ||
    boundLeaseCreatedAtMs !== leaseAcquiredAtMs ||
    leaseExpiresAtMs <= boundLeaseCreatedAtMs ||
    leaseExpiresAtMs - boundLeaseCreatedAtMs > 86_400_000 ||
    boundLeaseHeartbeatAtMs < boundLeaseCreatedAtMs ||
    boundLeaseHeartbeatAtMs > judgeReceipt.issuedAt ||
    !Number.isFinite(judgeStartedAtMs) ||
    !Number.isFinite(judgeEndedAtMs) ||
    startedAtMs < leaseAcquiredAtMs ||
    endedAtMs > capturedAtMs ||
    capturedAtMs > evaluatedAtMs ||
    judgeStartedAtMs < capturedAtMs ||
    judgeEndedAtMs < judgeStartedAtMs ||
    judgeReceipt.issuedAt < judgeEndedAtMs ||
    judgeReceipt.issuedAt > evaluatedAtMs ||
    evaluatedAtMs > leaseExpiresAtMs ||
    judgeReceipt.issuedAt > leaseExpiresAtMs
  ) {
    blockers.push("runtime trial falls outside the certification lease and evaluation window");
  }
  const signedPayload = {
    ...buildControlDirectorModelEvalTrialSignedPayload(trialWithoutReceipt, {
      ...receiptWithoutDigest,
      receiptSha256: trial.runtimeReceipt.receiptSha256,
    }),
    signature: trial.runtimeReceipt.signature,
    publicKeyId: trial.runtimeReceipt.publicKeyId,
  };
  if (
    !expected?.judgePublicKeyPem ||
    !expected?.judgePublicKeyId ||
    trial.runtimeReceipt.publicKeyId !== expected.judgePublicKeyId ||
    !verifyJudgeReceipt(signedPayload, { publicKeyPem: expected.judgePublicKeyPem })
  ) {
    blockers.push("runtime receipt is not signed by the authorized independent Judge key");
  }
  const artifactBindings = [trial.runtimeReceipt.telemetry, ...trial.runtimeReceipt.artifacts];
  if (
    !expected?.verifyArtifact ||
    artifactBindings.some((artifact) => !expected.verifyArtifact?.(artifact))
  ) {
    blockers.push("runtime receipt artifacts were not independently digest-verified");
  }
  return blockers;
}

export function evaluateControlDirectorModelTrial(
  trial: ControlDirectorModelEvalTrial,
  expected?: {
    modelIdentity?: { modelDigest: string; cacheDigest: string };
    sourceSha?: string;
    configurationDigest?: string;
    modelRef?: string;
    activeReleaseId?: string;
    rollbackReleaseId?: string;
    leaseOwner?: string;
    approvalId?: string;
    operationId?: string;
    invocationId?: string;
    judgeAgentId?: string;
    judgePublicKeyPem?: string;
    judgePublicKeyId?: string;
    leaseAcquiredAt?: string;
    evaluatedAt?: string;
    verifyArtifact?: ControlDirectorModelEvalArtifactVerifier;
    readArtifact?: ControlDirectorModelEvalArtifactReader;
  },
): ControlDirectorModelEvalTrialResult {
  const observations = [
    ...buildControlDirectorLatencyObservations({
      ...trial,
      evidencePrefix: evidence(trial, "latency"),
    }),
    ...(trial.taskClass === "recall"
      ? [
          booleanQualityObservation({
            metric: "recent_recall_top3" as const,
            passed: trial.recentRecallTop3,
            score: trial.recentRecallTop3 ? 100 : 0,
            observed: trial.recentRecallTop3
              ? "relevant source in Top-3"
              : "relevant source missed Top-3",
            evidenceRef: evidence(trial, "recall"),
          }),
        ]
      : []),
    booleanQualityObservation({
      metric: "instruction_coverage",
      passed: trial.instructionCoveragePercent >= 98,
      score: trial.instructionCoveragePercent,
      observed: `${trial.instructionCoveragePercent}% instruction coverage`,
      evidenceRef: evidence(trial, "coverage"),
    }),
    booleanQualityObservation({
      metric: "mission_continuity",
      passed: trial.missionContinuity,
      observed: trial.missionContinuity ? "mission retained" : "mission lost",
      evidenceRef: evidence(trial, "mission"),
    }),
    ...(trial.taskClass === "verification"
      ? [
          booleanQualityObservation({
            metric: "completion_proof" as const,
            passed: trial.completionProofValid,
            observed: trial.completionProofValid
              ? "valid claim-bound proof"
              : "proof invalid or missing",
            evidenceRef: evidence(trial, "judge"),
          }),
        ]
      : []),
    booleanQualityObservation({
      metric: "layout_visibility",
      passed: trial.layoutVisible,
      observed: trial.layoutVisible ? "chat visible" : "chat obstructed",
      evidenceRef: evidence(trial, "layout"),
    }),
  ];
  const quality = assessControlDirectorQuality(observations);
  const evidenceBlockers = trialEvidenceBlockers(trial);
  const provenanceBlockers = trialProvenanceBlockers(trial, expected);
  const provenanceVerified = provenanceBlockers.length === 0;
  const resourcePassed =
    evidenceBlockers.length === 0 &&
    provenanceVerified &&
    trial.peakCpuPercent <= MAX_CPU_PERCENT &&
    trial.peakMemoryGb <= MAX_MEMORY_GB &&
    trial.thermalPressure !== "critical";
  const blockers = [
    ...evidenceBlockers,
    ...provenanceBlockers,
    ...quality.criticalOmissions.map(
      (observation) => `${observation.metric}: ${observation.observed}`,
    ),
    ...(quality.score < 93 ? [`quality score ${quality.score} is below 93`] : []),
    ...(trial.peakCpuPercent > MAX_CPU_PERCENT
      ? [`peak CPU ${trial.peakCpuPercent}% exceeds ${MAX_CPU_PERCENT}%`]
      : []),
    ...(trial.peakMemoryGb > MAX_MEMORY_GB
      ? [`peak memory ${trial.peakMemoryGb}GB exceeds ${MAX_MEMORY_GB}GB`]
      : []),
    ...(trial.thermalPressure === "critical" ? ["critical thermal pressure"] : []),
  ];
  return {
    trial,
    quality,
    resourcePassed,
    provenanceVerified,
    passed: quality.passed && resourcePassed && evidenceBlockers.length === 0 && provenanceVerified,
    blockers,
  };
}

export function buildControlDirectorModelEvalMatrix(params: {
  trials: readonly ControlDirectorModelEvalTrial[];
  sourceSha: string;
  configurationDigest: string;
  modelRef: string;
  modelIdentity: { modelDigest: string; cacheDigest: string };
  verifyArtifact: ControlDirectorModelEvalArtifactVerifier;
  readArtifact?: ControlDirectorModelEvalArtifactReader;
  certification: {
    activeReleaseId: string;
    rollbackReleaseId: string;
    leaseOwner: string;
    approvalId: string;
    operationId: string;
    invocationId: string;
    judgeAgentId: string;
    judgePublicKeyPem: string;
    judgePublicKeyId: string;
    leaseAcquiredAt: string;
  };
  evaluatedAt?: string;
}): ControlDirectorModelEvalMatrix {
  const evaluatedAt = params.evaluatedAt ?? new Date().toISOString();
  const results = params.trials.map((trial) =>
    evaluateControlDirectorModelTrial(trial, {
      sourceSha: params.sourceSha,
      configurationDigest: params.configurationDigest,
      modelRef: params.modelRef,
      modelIdentity: params.modelIdentity,
      ...params.certification,
      evaluatedAt,
      verifyArtifact: params.verifyArtifact,
      readArtifact: params.readArtifact,
    }),
  );
  const judgeReceiptIds = new Set<string>();
  const judgeRunIds = new Set<string>();
  for (const result of results) {
    const judgeReceipt = result.trial.runtimeReceipt.judgeReceipt;
    if (judgeReceiptIds.has(judgeReceipt.receiptId) || judgeRunIds.has(judgeReceipt.judgeRunId)) {
      result.blockers.push("independent Judge receipt and run identities must be unique per trial");
      result.provenanceVerified = false;
      result.resourcePassed = false;
      result.passed = false;
    }
    judgeReceiptIds.add(judgeReceipt.receiptId);
    judgeRunIds.add(judgeReceipt.judgeRunId);
  }
  const byModel = new Map<string, ControlDirectorModelEvalTrialResult[]>();
  for (const result of results) {
    const group = byModel.get(result.trial.modelRef) ?? [];
    group.push(result);
    byModel.set(result.trial.modelRef, group);
  }
  const modelCoverage = new Map<string, string[]>();
  for (const [model, modelResults] of byModel) {
    const missing: string[] = [];
    for (const taskClass of CONTROL_DIRECTOR_EVAL_TASK_CLASSES) {
      for (const cold of [true, false] as const) {
        if (
          !modelResults.some(
            (result) => result.trial.taskClass === taskClass && result.trial.cold === cold,
          )
        ) {
          missing.push(`${model}: missing ${cold ? "cold" : "warm"} ${taskClass} trial`);
        }
      }
    }
    modelCoverage.set(model, missing);
  }
  const coverageBlockers = [...modelCoverage.values()].flat().toSorted();
  const coveragePassed = byModel.size > 0 && coverageBlockers.length === 0;
  const admittedModels = [...byModel.entries()]
    .filter(
      ([model, modelResults]) =>
        modelResults.length > 0 &&
        modelResults.every((result) => result.passed) &&
        modelCoverage.get(model)?.length === 0,
    )
    .map(([model]) => model)
    .toSorted();
  const rejectedModels = [...byModel.keys()]
    .filter((model) => !admittedModels.includes(model))
    .toSorted();
  const passedCount = results.filter((result) => result.passed).length;
  const criticalOmissions = results.reduce(
    (sum, result) => sum + result.quality.criticalOmissions.length,
    0,
  );
  const exactRuntime = results.length > 0 && results.every((result) => result.provenanceVerified);
  const trialReceiptSetDigest = digest(
    results
      .map((result) => ({
        trialId: result.trial.trialId,
        receiptSha256: result.trial.runtimeReceipt.receiptSha256,
      }))
      .toSorted((left, right) => left.trialId.localeCompare(right.trialId)),
  );
  return {
    schemaVersion: CONTROL_DIRECTOR_MODEL_EVAL_VERSION,
    evaluatedAt,
    sourceSha: params.sourceSha,
    configurationDigest: params.configurationDigest,
    modelRef: params.modelRef,
    modelIdentity: params.modelIdentity,
    trialReceiptSetDigest,
    exactRuntime,
    passed:
      exactRuntime &&
      results.length > 0 &&
      passedCount === results.length &&
      criticalOmissions === 0 &&
      coveragePassed,
    passRate: results.length === 0 ? 0 : Math.round((passedCount / results.length) * 1_000) / 10,
    criticalOmissions,
    coveragePassed,
    coverageBlockers,
    results,
    admittedModels,
    rejectedModels,
  };
}

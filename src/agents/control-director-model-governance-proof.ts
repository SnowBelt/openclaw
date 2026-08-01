import { createHash } from "node:crypto";

const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const MODEL_EVAL_TASK_CLASSES = [
  "conversation",
  "recall",
  "planning",
  "delegation",
  "steering",
  "verification",
] as const;

export const CONTROL_DIRECTOR_MODEL_GOVERNANCE_PROOF_SCHEMA =
  "openclaw.control-director-model-governance-proof.v1";
export const CONTROL_DIRECTOR_STABILITY_PROOF_SCHEMA =
  "openclaw.control-director-stability-proof.v3";
export const CONTROL_DIRECTOR_STABILITY_SAMPLE_SCHEMA =
  "openclaw.control-director-stability-sample.v1";

export const CONTROL_DIRECTOR_MODEL_GOVERNANCE_FACT_IDS = Object.freeze([
  "M87-model-admission-identity",
  "M88-evidence-invalidation-graph",
  "M89-transactional-model-config",
  "M90-residency-lease-prewarm",
  "M91-latency-phase-telemetry",
  "M92-qualified-local-fallback",
  "M93-proof-gated-quality-cascade",
  "M94-bounded-shadow-challenger",
  "M95-judge-diversity",
  "M96-statistical-evaluation",
  "M97-cache-identity",
  "M98-immutable-runtime-invocation",
  "M99-pcc-observability",
  "M100-sig-incidents",
  "M101-proof-planner",
  "M102-workflow-skill-convergence",
] as const);

export const CONTROL_DIRECTOR_STABILITY_FACT_IDS = Object.freeze([
  "M103-chaos-suite",
  "M104-fallback-rollback-restoration",
  "M105-extended-monitoring",
  "M106-final-ledger-closure",
] as const);

export type ControlDirectorModelGovernanceFactId =
  (typeof CONTROL_DIRECTOR_MODEL_GOVERNANCE_FACT_IDS)[number];
export type ControlDirectorStabilityFactId = (typeof CONTROL_DIRECTOR_STABILITY_FACT_IDS)[number];

export interface ControlDirectorProofFact<Id extends string = string> {
  id: Id;
  passed: true;
  checkedAt: string;
  evidenceRefs: string[];
  qualityScore?: number;
}

export interface ControlDirectorModelGovernanceProof {
  schema: typeof CONTROL_DIRECTOR_MODEL_GOVERNANCE_PROOF_SCHEMA;
  sourceSha: string;
  generatedAt: string;
  passed: true;
  requiredQualityScore: number;
  minimumQualityScore: number;
  failedCritical: [];
  evidenceRefs: string[];
  modelIdentity: {
    sourceSha: string;
    selectedModel: string;
    identityDigest: string;
    modelDigest: string;
    configDigest: string;
    cacheDigest: string;
  };
  statisticalEvaluation: {
    trialCount: number;
    passRate: 100;
    criticalOmissions: 0;
    minimumQualityScore: number;
    trialSetDigest: string;
  };
  facts: Array<ControlDirectorProofFact<ControlDirectorModelGovernanceFactId>>;
}

export interface ControlDirectorCacheIdentityEvidence {
  selectedModel: string;
  modelId: string;
  modelDigest: string;
  manifestDigest: string;
  baseBlobDigests: string[];
  kvCacheType: string;
  residentModelId: string;
  residentDigest: string;
  residentSizeBytes: number;
  residentVramBytes: number;
  cacheDigest: string;
}

export interface ControlDirectorRuntimeIdentityCapture {
  schema: "openclaw.control-director-runtime-identity-capture.v1";
  phase: "pre-rollback" | "restored";
  transitionId: string;
  capturedAt: string;
  sourceSha: string;
  activeReleaseId: string;
  configDigest: string;
  invocationId: string;
  transcripts: Record<string, { path: string; sha256: string }>;
}

export interface ControlDirectorCacheIdentityCaptureEvidence extends ControlDirectorCacheIdentityEvidence {
  capture: ControlDirectorRuntimeIdentityCapture;
}

export interface ControlDirectorStabilityProof {
  schema: typeof CONTROL_DIRECTOR_STABILITY_PROOF_SCHEMA;
  sourceSha: string;
  generatedAt: string;
  passed: true;
  failedCritical: [];
  evidenceRefs: string[];
  monitoring: {
    startedAt: string;
    endedAt: string;
    activeSoakMinutes: number;
    passiveMonitorHours: number;
    routeDriftDetected: false;
    capabilityLossDetected: false;
    sampleCount: number;
    sampleSetDigest: string;
    sourceSha: string;
    activeReleaseId: string;
    selectedModel: string;
    configDigest: string;
    samples: ControlDirectorStabilitySampleBinding[];
  };
  restoration: {
    rollbackSha: string;
    activeReleaseId: string;
    rollbackReleaseId: string;
    rollbackRestored: true;
    fallbackOrderRestored: true;
    cacheIdentityRestored: true;
    proofStateRestored: true;
    owner: string;
    approvalId: string;
    operationId: string;
    invocationId: string;
    lifecycleReceiptSetDigest: string;
    preRollbackCache: ControlDirectorEvidenceBinding<ControlDirectorCacheIdentityCaptureEvidence>;
    restoredCache: ControlDirectorEvidenceBinding<ControlDirectorCacheIdentityCaptureEvidence>;
    preRollbackFallbackOrder: ControlDirectorEvidenceBinding<ControlDirectorFallbackOrderEvidence>;
    restoredFallbackOrder: ControlDirectorEvidenceBinding<ControlDirectorFallbackOrderEvidence>;
    receipts: ControlDirectorLifecycleReceiptBindings;
  };
  facts: Array<ControlDirectorProofFact<ControlDirectorStabilityFactId>>;
}

export interface ControlDirectorStabilitySample {
  schema: typeof CONTROL_DIRECTOR_STABILITY_SAMPLE_SCHEMA;
  checkedAt: string;
  mode: "active" | "passive";
  sourceSha: string;
  activeReleaseId: string;
  selectedModel: string;
  configDigest: string;
  gatewayHealthy: true;
  capabilitiesPassed: 35;
  routeDriftDetected: false;
  capabilityLossDetected: false;
  cacheDigest: string;
  cacheEvidence: ControlDirectorEvidenceBinding<ControlDirectorCacheIdentityCaptureEvidence>;
  capabilityObservation: ControlDirectorEvidenceBinding<Record<string, unknown>>;
  capabilityObservationSha256: string;
}

export interface ControlDirectorEvidenceBinding<T> {
  path: string;
  sha256: string;
  receipt: T;
}

export interface ControlDirectorFallbackOrderEvidence extends Record<string, unknown> {
  schema: "openclaw.control-director-fallback-order.v2";
  sourceSha: string;
  activeReleaseId: string;
  selectedModel: string;
  order: string[];
  orderDigest: string;
  capture: ControlDirectorRuntimeIdentityCapture;
}

export interface ControlDirectorStabilitySampleBinding {
  path: string;
  sha256: string;
  receipt: ControlDirectorStabilitySample;
  sampleDigest: string;
}

export interface ControlDirectorLifecycleReceiptBinding {
  path: string;
  sha256: string;
  receipt: Record<string, unknown>;
}

export interface ControlDirectorLifecycleReceiptBindings {
  acquired: ControlDirectorLifecycleReceiptBinding;
  promoted: ControlDirectorLifecycleReceiptBinding;
  rollbackAuthorized: ControlDirectorLifecycleReceiptBinding;
  rolledBack: ControlDirectorLifecycleReceiptBinding;
  restored: ControlDirectorLifecycleReceiptBinding;
}

function assertSha(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA_PATTERN.test(normalized)) {
    throw new Error(`${label} must be an immutable 40-character SHA.`);
  }
  return normalized;
}

function assertDigest(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!DIGEST_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a 64-character SHA-256 digest.`);
  }
  return normalized;
}

function assertDate(value: string, label: string): string {
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be a valid timestamp.`);
  }
  return value;
}

function assertIdentity(value: string, label: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9._:@/+~-]{1,160}$/u.test(normalized)) {
    throw new Error(`${label} must be a bounded typed identity.`);
  }
  return normalized;
}

function assertEvidenceRefs(value: readonly string[], label: string): string[] {
  const refs = value.filter((entry) => entry.trim());
  if (refs.length === 0) {
    throw new Error(`${label} requires at least one evidence reference.`);
  }
  return [...refs];
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function assertRelativeArtifactPath(value: string, label: string): string {
  const normalized = value.trim().replaceAll("\\", "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//u.test(normalized) ||
    normalized.split("/").includes("..")
  ) {
    throw new Error(`${label} must be a contained relative artifact path.`);
  }
  return normalized;
}

function canonicalStabilitySample(
  sample: Omit<ControlDirectorStabilitySampleBinding, "sampleDigest">,
): Record<string, unknown> {
  return {
    path: sample.path,
    sha256: sample.sha256,
    receipt: sample.receipt,
  };
}

export function digestControlDirectorStabilitySample(
  sample: Omit<ControlDirectorStabilitySampleBinding, "sampleDigest">,
): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalStabilitySample(sample)))
    .digest("hex");
}

export function digestControlDirectorStabilitySamples(
  samples: readonly ControlDirectorStabilitySampleBinding[],
): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        [...samples]
          .toSorted(
            (left, right) =>
              Date.parse(left.receipt.checkedAt) - Date.parse(right.receipt.checkedAt),
          )
          .map((sample) => ({
            checkedAt: sample.receipt.checkedAt,
            path: sample.path,
            sha256: sample.sha256,
            sampleDigest: sample.sampleDigest,
          })),
      ),
    )
    .digest("hex");
}

function requireCompleteFactLedger<Id extends string>(
  facts: ReadonlyArray<ControlDirectorProofFact<Id>>,
  requiredIds: readonly Id[],
  label: string,
): Array<ControlDirectorProofFact<Id>> {
  const normalized = facts.map((fact) => ({
    ...fact,
    id: fact.id,
    checkedAt: assertDate(fact.checkedAt, `${label}.${fact.id}.checkedAt`),
    evidenceRefs: assertEvidenceRefs(fact.evidenceRefs, `${label}.${fact.id}.evidenceRefs`),
  }));
  for (const fact of normalized) {
    if (!fact.passed) {
      throw new Error(`${label}.${fact.id} must be passed.`);
    }
    if (
      fact.qualityScore !== undefined &&
      (!Number.isFinite(fact.qualityScore) || fact.qualityScore < 0)
    ) {
      throw new Error(`${label}.${fact.id}.qualityScore must be finite when present.`);
    }
  }
  const ids = new Set(normalized.map((fact) => fact.id));
  const missing = requiredIds.filter((id) => !ids.has(id));
  if (missing.length > 0) {
    throw new Error(`${label} omits required facts: ${missing.join(", ")}.`);
  }
  return normalized;
}

export function digestModelGovernanceIdentity(params: {
  sourceSha: string;
  selectedModel: string;
  modelDigest: string;
  configDigest: string;
  cacheDigest: string;
}): string {
  const sourceSha = assertSha(params.sourceSha, "sourceSha");
  const modelDigest = assertDigest(params.modelDigest, "modelDigest");
  const configDigest = assertDigest(params.configDigest, "configDigest");
  const cacheDigest = assertDigest(params.cacheDigest, "cacheDigest");
  if (!params.selectedModel.trim()) {
    throw new Error("selectedModel requires a non-empty value.");
  }
  return createHash("sha256")
    .update(
      JSON.stringify({
        sourceSha,
        selectedModel: params.selectedModel.trim(),
        modelDigest,
        configDigest,
        cacheDigest,
      }),
    )
    .digest("hex");
}

export function buildControlDirectorCacheIdentityEvidence(params: {
  selectedModel: string;
  modelId: string;
  modelDigest: string;
  manifestDigest: string;
  baseBlobDigests: readonly string[];
  kvCacheType: string;
  residency: {
    modelId: string;
    digest: string;
    sizeBytes: number;
    vramBytes: number;
  };
}): ControlDirectorCacheIdentityEvidence {
  const selectedModel = params.selectedModel.trim();
  const modelId = params.modelId.trim();
  const modelDigest = assertDigest(params.modelDigest, "modelDigest");
  const manifestDigest = assertDigest(params.manifestDigest, "manifestDigest");
  const baseBlobDigests = params.baseBlobDigests
    .map((digest) => assertDigest(digest, "baseBlobDigest"))
    .toSorted((left, right) => left.localeCompare(right));
  const kvCacheType = params.kvCacheType.trim();
  const residentModelId = params.residency.modelId.trim();
  const residentDigest = assertDigest(params.residency.digest, "residency.digest");
  const residentSizeBytes = params.residency.sizeBytes;
  const residentVramBytes = params.residency.vramBytes;
  if (
    !selectedModel ||
    !modelId ||
    !manifestDigest ||
    baseBlobDigests.length === 0 ||
    !kvCacheType ||
    residentModelId !== modelId ||
    residentDigest !== manifestDigest ||
    !Number.isSafeInteger(residentSizeBytes) ||
    residentSizeBytes <= 0 ||
    !Number.isSafeInteger(residentVramBytes) ||
    residentVramBytes <= 0
  ) {
    throw new Error("Cache identity evidence is not bound to a live immutable model residency.");
  }
  const evidence = {
    selectedModel,
    modelId,
    modelDigest,
    manifestDigest,
    baseBlobDigests,
    kvCacheType,
    residentModelId,
    residentDigest,
    residentSizeBytes,
    residentVramBytes,
  };
  return {
    ...evidence,
    cacheDigest: createHash("sha256").update(JSON.stringify(evidence)).digest("hex"),
  };
}

function normalizeEvidenceBinding<T>(
  binding: ControlDirectorEvidenceBinding<T>,
  label: string,
): ControlDirectorEvidenceBinding<T> {
  return {
    path: assertRelativeArtifactPath(binding.path, `${label}.path`),
    sha256: assertDigest(binding.sha256, `${label}.sha256`),
    receipt: binding.receipt,
  };
}

function recomputeCacheEvidence(
  evidence: ControlDirectorCacheIdentityEvidence,
): ControlDirectorCacheIdentityEvidence {
  return buildControlDirectorCacheIdentityEvidence({
    selectedModel: evidence.selectedModel,
    modelId: evidence.modelId,
    modelDigest: evidence.modelDigest,
    manifestDigest: evidence.manifestDigest,
    baseBlobDigests: evidence.baseBlobDigests,
    kvCacheType: evidence.kvCacheType,
    residency: {
      modelId: evidence.residentModelId,
      digest: evidence.residentDigest,
      sizeBytes: evidence.residentSizeBytes,
      vramBytes: evidence.residentVramBytes,
    },
  });
}

function validateRuntimeIdentityCapture(
  capture: ControlDirectorRuntimeIdentityCapture,
  expected: {
    phase: "pre-rollback" | "restored";
    sourceSha: string;
    activeReleaseId: string;
    configDigest: string;
    invocationId: string;
  },
  label: string,
): ControlDirectorRuntimeIdentityCapture {
  const transcripts = object(capture.transcripts, `${label}.transcripts`);
  const requiredTranscripts = [
    "config",
    "lifecycle",
    "ollamaList",
    "ollamaModelfile",
    "ollamaPs",
    "ollamaLaunchctl",
  ];
  if (
    capture.schema !== "openclaw.control-director-runtime-identity-capture.v1" ||
    capture.phase !== expected.phase ||
    capture.sourceSha !== expected.sourceSha ||
    capture.activeReleaseId !== expected.activeReleaseId ||
    capture.configDigest !== expected.configDigest ||
    capture.invocationId !== expected.invocationId ||
    !DIGEST_PATTERN.test(capture.transitionId) ||
    !capture.capturedAt ||
    !Number.isFinite(Date.parse(capture.capturedAt)) ||
    JSON.stringify(Object.keys(transcripts).toSorted()) !==
      JSON.stringify(requiredTranscripts.toSorted())
  ) {
    throw new Error(`${label} is not a complete exact-runtime capture.`);
  }
  for (const name of requiredTranscripts) {
    const transcript = object(transcripts[name], `${label}.transcripts.${name}`);
    if (typeof transcript.path !== "string" || typeof transcript.sha256 !== "string") {
      throw new Error(`${label}.transcripts.${name} must bind a path and digest.`);
    }
    assertRelativeArtifactPath(transcript.path, `${label}.transcripts.${name}.path`);
    assertDigest(transcript.sha256, `${label}.transcripts.${name}.sha256`);
  }
  return capture;
}

export interface ControlDirectorStatisticalTrialResult {
  trial: {
    trialId: string;
    taskClass: (typeof MODEL_EVAL_TASK_CLASSES)[number];
    cold: boolean;
    modelRef: string;
    route: "local";
    evidenceRefs: string[];
  };
  quality: { score: number };
  resourcePassed: true;
  passed: true;
  blockers: [];
}

function canonicalStatisticalTrials(
  results: readonly ControlDirectorStatisticalTrialResult[],
): Array<Record<string, unknown> & { trialId: string }> {
  return results
    .map((result) => ({
      trialId: result.trial.trialId,
      taskClass: result.trial.taskClass,
      cold: result.trial.cold,
      modelRef: result.trial.modelRef,
      route: result.trial.route,
      evidenceRefs: [...result.trial.evidenceRefs].toSorted(),
      qualityScore: result.quality.score,
      resourcePassed: result.resourcePassed,
      passed: result.passed,
      blockers: [...result.blockers],
    }))
    .toSorted((left, right) => left.trialId.localeCompare(right.trialId));
}

export function digestControlDirectorStatisticalTrials(
  results: readonly ControlDirectorStatisticalTrialResult[],
): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalStatisticalTrials(results)))
    .digest("hex");
}

function validateStatisticalTrials(
  results: readonly ControlDirectorStatisticalTrialResult[],
  selectedModel: string,
  requiredQualityScore: number,
) {
  if (results.length < 48) {
    throw new Error("Model governance statistical evaluation requires 48 concrete trials.");
  }
  const trialIds = new Set<string>();
  const coverage = new Set<string>();
  let minimumQualityScore = Number.POSITIVE_INFINITY;
  for (const result of results) {
    const trial = result.trial;
    if (!trial.trialId.trim() || trialIds.has(trial.trialId)) {
      throw new Error("Model governance statistical trial IDs must be unique and non-empty.");
    }
    trialIds.add(trial.trialId);
    if (
      !MODEL_EVAL_TASK_CLASSES.includes(trial.taskClass) ||
      typeof trial.cold !== "boolean" ||
      trial.modelRef !== selectedModel ||
      trial.route !== "local" ||
      assertEvidenceRefs(trial.evidenceRefs, `trial.${trial.trialId}.evidenceRefs`).length === 0 ||
      !result.passed ||
      !result.resourcePassed ||
      result.blockers.length !== 0 ||
      !Number.isFinite(result.quality.score) ||
      result.quality.score < requiredQualityScore
    ) {
      throw new Error("Model governance statistical trial is not an exact-runtime 93+ local pass.");
    }
    coverage.add(`${trial.taskClass}:${trial.cold ? "cold" : "warm"}`);
    minimumQualityScore = Math.min(minimumQualityScore, result.quality.score);
  }
  if (
    MODEL_EVAL_TASK_CLASSES.some(
      (taskClass) => !coverage.has(`${taskClass}:cold`) || !coverage.has(`${taskClass}:warm`),
    )
  ) {
    throw new Error("Model governance statistical trials omit required cold/warm task coverage.");
  }
  return {
    trialCount: results.length,
    minimumQualityScore,
    trialSetDigest: digestControlDirectorStatisticalTrials(results),
  };
}

export function buildControlDirectorModelGovernanceProof(params: {
  sourceSha: string;
  selectedModel: string;
  modelDigest: string;
  configDigest: string;
  cacheDigest: string;
  generatedAt: string;
  requiredQualityScore?: number;
  statisticalEvaluation: {
    results: readonly ControlDirectorStatisticalTrialResult[];
  };
  evidenceRefs: readonly string[];
  facts: ReadonlyArray<ControlDirectorProofFact<ControlDirectorModelGovernanceFactId>>;
}): ControlDirectorModelGovernanceProof {
  const sourceSha = assertSha(params.sourceSha, "sourceSha");
  const requiredQualityScore = params.requiredQualityScore ?? 93;
  if (requiredQualityScore < 93) {
    throw new Error("requiredQualityScore must be at least 93.");
  }
  if (!params.selectedModel.trim()) {
    throw new Error("selectedModel requires a non-empty value.");
  }
  const facts = requireCompleteFactLedger(
    params.facts,
    CONTROL_DIRECTOR_MODEL_GOVERNANCE_FACT_IDS,
    "modelGovernanceProof.facts",
  );
  const statisticalEvaluation = validateStatisticalTrials(
    params.statisticalEvaluation.results,
    params.selectedModel.trim(),
    requiredQualityScore,
  );
  const minimumFactQuality = Math.min(...facts.map((fact) => fact.qualityScore ?? 100));
  const minimumQualityScore = Math.min(
    statisticalEvaluation.minimumQualityScore,
    minimumFactQuality,
  );
  if (minimumQualityScore < requiredQualityScore) {
    throw new Error("Model governance minimum quality score is below the required floor.");
  }
  return {
    schema: CONTROL_DIRECTOR_MODEL_GOVERNANCE_PROOF_SCHEMA,
    sourceSha,
    generatedAt: assertDate(params.generatedAt, "generatedAt"),
    passed: true,
    requiredQualityScore,
    minimumQualityScore,
    failedCritical: [],
    evidenceRefs: assertEvidenceRefs(params.evidenceRefs, "modelGovernanceProof.evidenceRefs"),
    modelIdentity: {
      sourceSha,
      selectedModel: params.selectedModel.trim(),
      identityDigest: digestModelGovernanceIdentity({
        sourceSha,
        selectedModel: params.selectedModel,
        modelDigest: params.modelDigest,
        configDigest: params.configDigest,
        cacheDigest: params.cacheDigest,
      }),
      modelDigest: assertDigest(params.modelDigest, "modelDigest"),
      configDigest: assertDigest(params.configDigest, "configDigest"),
      cacheDigest: assertDigest(params.cacheDigest, "cacheDigest"),
    },
    statisticalEvaluation: {
      trialCount: statisticalEvaluation.trialCount,
      passRate: 100,
      criticalOmissions: 0,
      minimumQualityScore: statisticalEvaluation.minimumQualityScore,
      trialSetDigest: statisticalEvaluation.trialSetDigest,
    },
    facts,
  };
}

export function buildControlDirectorStabilityProof(params: {
  sourceSha: string;
  generatedAt: string;
  evidenceRefs: readonly string[];
  monitoring: {
    samples: readonly ControlDirectorStabilitySampleBinding[];
  };
  restoration: {
    rollbackSha: string;
    activeReleaseId: string;
    rollbackReleaseId: string;
    owner: string;
    approvalId: string;
    operationId: string;
    invocationId: string;
    preRollbackCache: ControlDirectorEvidenceBinding<ControlDirectorCacheIdentityCaptureEvidence>;
    restoredCache: ControlDirectorEvidenceBinding<ControlDirectorCacheIdentityCaptureEvidence>;
    preRollbackFallbackOrder: ControlDirectorEvidenceBinding<ControlDirectorFallbackOrderEvidence>;
    restoredFallbackOrder: ControlDirectorEvidenceBinding<ControlDirectorFallbackOrderEvidence>;
    receipts: ControlDirectorLifecycleReceiptBindings;
  };
  facts: ReadonlyArray<ControlDirectorProofFact<ControlDirectorStabilityFactId>>;
}): ControlDirectorStabilityProof {
  const sourceSha = assertSha(params.sourceSha, "sourceSha");
  const generatedAt = assertDate(params.generatedAt, "generatedAt");
  const facts = requireCompleteFactLedger(
    params.facts,
    CONTROL_DIRECTOR_STABILITY_FACT_IDS,
    "stabilityProof.facts",
  );
  const samples = [...params.monitoring.samples].toSorted(
    (left, right) => Date.parse(left.receipt.checkedAt) - Date.parse(right.receipt.checkedAt),
  );
  if (samples.length < 2) {
    throw new Error("Stability monitoring requires timestamped exact-runtime samples.");
  }
  const observedTimes = new Set<number>();
  for (const [index, binding] of samples.entries()) {
    const sample = binding.receipt;
    const checkedAt = assertDate(sample.checkedAt, `monitoring.samples[${index}].checkedAt`);
    const checkedAtMs = Date.parse(checkedAt);
    if (observedTimes.has(checkedAtMs)) {
      throw new Error("Stability monitoring sample timestamps must be unique.");
    }
    observedTimes.add(checkedAtMs);
    if (sample.schema !== CONTROL_DIRECTOR_STABILITY_SAMPLE_SCHEMA) {
      throw new Error("Stability monitoring contains an unsupported sample receipt.");
    }
    assertIdentity(sample.activeReleaseId, `monitoring.samples[${index}].activeReleaseId`);
    assertIdentity(sample.selectedModel, `monitoring.samples[${index}].selectedModel`);
    assertDigest(sample.configDigest, `monitoring.samples[${index}].configDigest`);
    assertDigest(sample.cacheDigest, `monitoring.samples[${index}].cacheDigest`);
    assertDigest(
      sample.capabilityObservationSha256,
      `monitoring.samples[${index}].capabilityObservationSha256`,
    );
    const cacheEvidence = normalizeEvidenceBinding(
      sample.cacheEvidence,
      `monitoring.samples[${index}].cacheEvidence`,
    );
    const capabilityObservation = normalizeEvidenceBinding(
      sample.capabilityObservation,
      `monitoring.samples[${index}].capabilityObservation`,
    );
    const observationReceipt = object(
      capabilityObservation.receipt,
      `monitoring.samples[${index}].capabilityObservation.receipt`,
    );
    const recomputedCache = recomputeCacheEvidence(cacheEvidence.receipt);
    const cacheCapture = validateRuntimeIdentityCapture(
      cacheEvidence.receipt.capture,
      {
        phase: "restored",
        sourceSha,
        activeReleaseId: sample.activeReleaseId,
        configDigest: sample.configDigest,
        invocationId: params.restoration.invocationId,
      },
      `monitoring.samples[${index}].cacheEvidence.receipt.capture`,
    );
    const normalizedBinding = {
      path: assertRelativeArtifactPath(binding.path, `monitoring.samples[${index}].path`),
      sha256: assertDigest(binding.sha256, `monitoring.samples[${index}].sha256`),
      receipt: sample,
    };
    if (
      (sample.mode !== "active" && sample.mode !== "passive") ||
      assertSha(sample.sourceSha, `monitoring.samples[${index}].sourceSha`) !== sourceSha ||
      !sample.gatewayHealthy ||
      sample.capabilitiesPassed !== 35 ||
      sample.routeDriftDetected ||
      sample.capabilityLossDetected ||
      observationReceipt.phase !== "restored" ||
      observationReceipt.sourceSha !== sourceSha ||
      observationReceipt.releaseId !== sample.activeReleaseId ||
      typeof observationReceipt.selectedModelId !== "string" ||
      `ollama/${observationReceipt.selectedModelId}` !== sample.selectedModel ||
      observationReceipt.checkedAt !== sample.checkedAt ||
      !Array.isArray(observationReceipt.configurationDigests) ||
      observationReceipt.configurationDigests[0] !== sample.configDigest ||
      !Array.isArray(observationReceipt.capabilities) ||
      observationReceipt.capabilities.length !== 35 ||
      observationReceipt.contentSha256 !== sample.capabilityObservationSha256 ||
      recomputedCache.selectedModel !== sample.selectedModel ||
      recomputedCache.cacheDigest !== sample.cacheDigest ||
      Date.parse(cacheCapture.capturedAt) > checkedAtMs ||
      checkedAtMs - Date.parse(cacheCapture.capturedAt) > 300_000 ||
      assertDigest(binding.sampleDigest, `monitoring.samples[${index}].sampleDigest`) !==
        digestControlDirectorStabilitySample(normalizedBinding)
    ) {
      throw new Error("Stability monitoring contains an invalid or unhealthy sample.");
    }
  }
  const startedAtMs = Date.parse(samples[0]!.receipt.checkedAt);
  const endedAtMs = Date.parse(samples.at(-1)!.receipt.checkedAt);
  const passiveSamples = samples.filter((sample) => sample.receipt.mode === "passive");
  const passiveMonitorHours =
    passiveSamples.length < 2
      ? 0
      : (Date.parse(passiveSamples.at(-1)!.receipt.checkedAt) -
          Date.parse(passiveSamples[0]!.receipt.checkedAt)) /
        3_600_000;
  const maximumPassiveGapMs = passiveSamples
    .slice(1)
    .reduce(
      (maximum, sample, index) =>
        Math.max(
          maximum,
          Date.parse(sample.receipt.checkedAt) -
            Date.parse(passiveSamples[index]!.receipt.checkedAt),
        ),
      0,
    );
  const activeSamples = samples.filter((sample) => sample.receipt.mode === "active");
  const activeSoakMinutes =
    activeSamples.length < 2
      ? 0
      : (Date.parse(activeSamples.at(-1)!.receipt.checkedAt) -
          Date.parse(activeSamples[0]!.receipt.checkedAt)) /
        60_000;
  const maximumActiveGapMs = activeSamples
    .slice(1)
    .reduce(
      (maximum, sample, index) =>
        Math.max(
          maximum,
          Date.parse(sample.receipt.checkedAt) -
            Date.parse(activeSamples[index]!.receipt.checkedAt),
        ),
      0,
    );
  if (
    activeSoakMinutes < 30 ||
    passiveMonitorHours < 24 ||
    maximumPassiveGapMs > 300_000 ||
    maximumActiveGapMs > 60_000 ||
    Date.parse(generatedAt) < endedAtMs
  ) {
    throw new Error(
      "Stability monitoring must derive 30 continuous active minutes and 24 continuous passive hours.",
    );
  }
  const firstSample = samples[0]!.receipt;
  if (
    samples.some(
      (sample) =>
        sample.receipt.activeReleaseId !== firstSample.activeReleaseId ||
        sample.receipt.selectedModel !== firstSample.selectedModel ||
        sample.receipt.configDigest !== firstSample.configDigest ||
        sample.receipt.cacheDigest !== firstSample.cacheDigest,
    )
  ) {
    throw new Error("Stability monitoring changed release, model, or configuration identity.");
  }
  const rollbackSha = assertSha(params.restoration.rollbackSha, "restoration.rollbackSha");
  const activeReleaseId = assertIdentity(
    params.restoration.activeReleaseId,
    "restoration.activeReleaseId",
  );
  const rollbackReleaseId = assertIdentity(
    params.restoration.rollbackReleaseId,
    "restoration.rollbackReleaseId",
  );
  if (activeReleaseId === rollbackReleaseId) {
    throw new Error("Stability restoration requires distinct active and rollback releases.");
  }
  if (firstSample.activeReleaseId !== activeReleaseId) {
    throw new Error("Stability monitor release does not match the restored active release.");
  }
  const owner = assertIdentity(params.restoration.owner, "restoration.owner");
  const approvalId = assertIdentity(params.restoration.approvalId, "restoration.approvalId");
  const operationId = assertIdentity(params.restoration.operationId, "restoration.operationId");
  const invocationId = assertIdentity(params.restoration.invocationId, "restoration.invocationId");
  const preRollbackCache = normalizeEvidenceBinding(
    params.restoration.preRollbackCache,
    "restoration.preRollbackCache",
  );
  const restoredCache = normalizeEvidenceBinding(
    params.restoration.restoredCache,
    "restoration.restoredCache",
  );
  const preRollbackFallbackOrder = normalizeEvidenceBinding(
    params.restoration.preRollbackFallbackOrder,
    "restoration.preRollbackFallbackOrder",
  );
  const restoredFallbackOrder = normalizeEvidenceBinding(
    params.restoration.restoredFallbackOrder,
    "restoration.restoredFallbackOrder",
  );
  if (
    preRollbackCache.path === restoredCache.path ||
    preRollbackFallbackOrder.path === restoredFallbackOrder.path
  ) {
    throw new Error("Stability restoration requires distinct pre-rollback and restored evidence.");
  }
  const preRollbackCacheCapture = validateRuntimeIdentityCapture(
    preRollbackCache.receipt.capture,
    {
      phase: "pre-rollback",
      sourceSha,
      activeReleaseId,
      configDigest: firstSample.configDigest,
      invocationId,
    },
    "restoration.preRollbackCache.receipt.capture",
  );
  const restoredCacheCapture = validateRuntimeIdentityCapture(
    restoredCache.receipt.capture,
    {
      phase: "restored",
      sourceSha,
      activeReleaseId,
      configDigest: firstSample.configDigest,
      invocationId,
    },
    "restoration.restoredCache.receipt.capture",
  );
  const preRollbackFallbackCapture = validateRuntimeIdentityCapture(
    preRollbackFallbackOrder.receipt.capture,
    {
      phase: "pre-rollback",
      sourceSha,
      activeReleaseId,
      configDigest: firstSample.configDigest,
      invocationId,
    },
    "restoration.preRollbackFallbackOrder.receipt.capture",
  );
  const restoredFallbackCapture = validateRuntimeIdentityCapture(
    restoredFallbackOrder.receipt.capture,
    {
      phase: "restored",
      sourceSha,
      activeReleaseId,
      configDigest: firstSample.configDigest,
      invocationId,
    },
    "restoration.restoredFallbackOrder.receipt.capture",
  );
  if (
    preRollbackCacheCapture.transitionId !== preRollbackFallbackCapture.transitionId ||
    restoredCacheCapture.transitionId !== restoredFallbackCapture.transitionId
  ) {
    throw new Error("Stability cache and fallback captures do not share lifecycle transitions.");
  }
  const preRollbackCacheDigest = recomputeCacheEvidence(preRollbackCache.receipt).cacheDigest;
  const restoredCacheDigest = recomputeCacheEvidence(restoredCache.receipt).cacheDigest;
  const recomputeFallbackOrder = (evidence: ControlDirectorFallbackOrderEvidence): string => {
    if (
      evidence.schema !== "openclaw.control-director-fallback-order.v2" ||
      evidence.sourceSha !== sourceSha ||
      evidence.activeReleaseId !== activeReleaseId ||
      evidence.selectedModel !== firstSample.selectedModel ||
      !Array.isArray(evidence.order) ||
      evidence.order.length === 0 ||
      evidence.order.some((entry) => typeof entry !== "string" || !entry.trim())
    ) {
      throw new Error("Stability fallback-order evidence has invalid exact bindings.");
    }
    const orderDigest = createHash("sha256").update(JSON.stringify(evidence.order)).digest("hex");
    if (assertDigest(evidence.orderDigest, "fallbackOrder.orderDigest") !== orderDigest) {
      throw new Error("Stability fallback-order evidence digest mismatch.");
    }
    return orderDigest;
  };
  const preRollbackFallbackOrderDigest = recomputeFallbackOrder(preRollbackFallbackOrder.receipt);
  const restoredFallbackOrderDigest = recomputeFallbackOrder(restoredFallbackOrder.receipt);
  const cacheIdentityRestored =
    preRollbackCacheDigest === restoredCacheDigest &&
    restoredCacheDigest === firstSample.cacheDigest;
  const fallbackOrderRestored = preRollbackFallbackOrderDigest === restoredFallbackOrderDigest;
  if (!cacheIdentityRestored || !fallbackOrderRestored) {
    throw new Error("Stability restoration did not restore cache and fallback identities.");
  }
  const receiptContracts = [
    ["acquired", "acquired", "acquired"],
    ["promoted", "promoted", "promoted"],
    ["rollbackAuthorized", "rollback-authorized", "promoted"],
    ["rolledBack", "rolled-back", "rollback-drill"],
    ["restored", "restored", "promoted"],
  ] as const;
  const receipts = {} as ControlDirectorLifecycleReceiptBindings;
  const receiptTimes: number[] = [];
  for (const [bindingName, result, state] of receiptContracts) {
    const binding = params.restoration.receipts[bindingName];
    const receipt = object(binding.receipt, `restoration.receipts.${bindingName}.receipt`);
    const lease = object(receipt.lease, `restoration.receipts.${bindingName}.receipt.lease`);
    const at =
      typeof receipt.at === "string"
        ? assertDate(receipt.at, `restoration.receipts.${bindingName}.receipt.at`)
        : assertDate("", `restoration.receipts.${bindingName}.receipt.at`);
    if (
      receipt.schema !== "openclaw.custom-runtime-certification-lease-receipt.v2" ||
      receipt.result !== result ||
      receipt.activeSha !== sourceSha ||
      receipt.candidateSha !== sourceSha ||
      receipt.approvalId !== approvalId ||
      receipt.operationId !== operationId ||
      receipt.invocationId !== invocationId ||
      lease.activeSha !== sourceSha ||
      lease.candidateSha !== sourceSha ||
      lease.rollbackSha !== rollbackSha ||
      lease.activeReleaseId !== activeReleaseId ||
      lease.rollbackReleaseId !== rollbackReleaseId ||
      lease.owner !== owner ||
      lease.approvalId !== approvalId ||
      lease.operationId !== operationId ||
      lease.invocationId !== invocationId ||
      lease.operationClass !== "release-certification" ||
      lease.state !== state
    ) {
      throw new Error(`Stability lifecycle receipt ${bindingName} has invalid exact bindings.`);
    }
    if (
      (bindingName === "rolledBack" || bindingName === "restored") &&
      (typeof receipt.transitionId !== "string" || !DIGEST_PATTERN.test(receipt.transitionId))
    ) {
      throw new Error(`Stability lifecycle receipt ${bindingName} lacks a transition ID.`);
    }
    receipts[bindingName] = {
      path: assertRelativeArtifactPath(binding.path, `restoration.receipts.${bindingName}.path`),
      sha256: assertDigest(binding.sha256, `restoration.receipts.${bindingName}.sha256`),
      receipt,
    };
    receiptTimes.push(Date.parse(at));
  }
  if (
    preRollbackCacheCapture.transitionId !== receipts.promoted.sha256 ||
    restoredCacheCapture.transitionId !== receipts.restored.receipt.transitionId ||
    samples.some(
      (sample) =>
        sample.receipt.cacheEvidence.receipt.capture.transitionId !==
        restoredCacheCapture.transitionId,
    )
  ) {
    throw new Error("Stability runtime-identity captures do not bind the lifecycle transitions.");
  }
  if (receiptTimes.some((time, index) => index > 0 && time < receiptTimes[index - 1]!)) {
    throw new Error("Stability lifecycle receipts are out of transition order.");
  }
  if (receiptTimes.at(-1)! > startedAtMs) {
    throw new Error("Stability monitoring began before rollback restoration completed.");
  }
  const lifecycleReceiptSetDigest = createHash("sha256")
    .update(
      JSON.stringify(
        receiptContracts.map(([bindingName, result]) => ({
          result,
          path: receipts[bindingName].path,
          sha256: receipts[bindingName].sha256,
        })),
      ),
    )
    .digest("hex");
  const rollbackRestored = receiptTimes.length === receiptContracts.length;
  const proofStateRestored =
    receiptTimes.at(-1)! <= startedAtMs &&
    samples.every((sample) => !sample.receipt.routeDriftDetected);
  if (!rollbackRestored || !proofStateRestored) {
    throw new Error("Stability restoration did not restore lifecycle proof state.");
  }
  return {
    schema: CONTROL_DIRECTOR_STABILITY_PROOF_SCHEMA,
    sourceSha,
    generatedAt,
    passed: true,
    failedCritical: [],
    evidenceRefs: assertEvidenceRefs(params.evidenceRefs, "stabilityProof.evidenceRefs"),
    monitoring: {
      startedAt: samples[0]!.receipt.checkedAt,
      endedAt: samples.at(-1)!.receipt.checkedAt,
      activeSoakMinutes,
      passiveMonitorHours,
      routeDriftDetected: false,
      capabilityLossDetected: false,
      sampleCount: samples.length,
      sampleSetDigest: digestControlDirectorStabilitySamples(samples),
      sourceSha,
      activeReleaseId,
      selectedModel: firstSample.selectedModel,
      configDigest: firstSample.configDigest,
      samples,
    },
    restoration: {
      rollbackSha,
      activeReleaseId,
      rollbackReleaseId,
      rollbackRestored,
      fallbackOrderRestored,
      cacheIdentityRestored,
      proofStateRestored,
      owner,
      approvalId,
      operationId,
      invocationId,
      lifecycleReceiptSetDigest,
      preRollbackCache,
      restoredCache,
      preRollbackFallbackOrder,
      restoredFallbackOrder,
      receipts,
    },
    facts,
  };
}

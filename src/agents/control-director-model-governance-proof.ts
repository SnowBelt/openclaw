import { createHash } from "node:crypto";

const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;

export const CONTROL_DIRECTOR_MODEL_GOVERNANCE_PROOF_SCHEMA =
  "openclaw.control-director-model-governance-proof.v1";
export const CONTROL_DIRECTOR_STABILITY_PROOF_SCHEMA =
  "openclaw.control-director-stability-proof.v1";

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
    configDigest: string;
  };
  statisticalEvaluation: {
    trialCount: number;
    passRate: 100;
    criticalOmissions: 0;
    minimumQualityScore: number;
  };
  facts: Array<ControlDirectorProofFact<ControlDirectorModelGovernanceFactId>>;
}

export interface ControlDirectorStabilityProof {
  schema: typeof CONTROL_DIRECTOR_STABILITY_PROOF_SCHEMA;
  sourceSha: string;
  generatedAt: string;
  passed: true;
  failedCritical: [];
  evidenceRefs: string[];
  monitoring: {
    activeSoakMinutes: number;
    passiveMonitorHours: number;
    routeDriftDetected: false;
    capabilityLossDetected: false;
  };
  restoration: {
    rollbackRestored: true;
    fallbackOrderRestored: true;
    cacheIdentityRestored: true;
    proofStateRestored: true;
  };
  facts: Array<ControlDirectorProofFact<ControlDirectorStabilityFactId>>;
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

function assertEvidenceRefs(value: readonly string[], label: string): string[] {
  const refs = value.filter((entry) => entry.trim());
  if (refs.length === 0) {
    throw new Error(`${label} requires at least one evidence reference.`);
  }
  return [...refs];
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

export function buildControlDirectorModelGovernanceProof(params: {
  sourceSha: string;
  selectedModel: string;
  identityDigest: string;
  configDigest: string;
  generatedAt: string;
  requiredQualityScore?: number;
  statisticalEvaluation: {
    trialCount: number;
    passRate: number;
    criticalOmissions: number;
    minimumQualityScore: number;
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
  const { statisticalEvaluation } = params;
  if (
    !Number.isInteger(statisticalEvaluation.trialCount) ||
    statisticalEvaluation.trialCount < 48 ||
    statisticalEvaluation.passRate !== 100 ||
    statisticalEvaluation.criticalOmissions !== 0 ||
    statisticalEvaluation.minimumQualityScore < requiredQualityScore
  ) {
    throw new Error(
      "Model governance statistical evaluation must prove 48 all-passing 93+ trials.",
    );
  }
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
      identityDigest: assertDigest(params.identityDigest, "identityDigest"),
      configDigest: assertDigest(params.configDigest, "configDigest"),
    },
    statisticalEvaluation: {
      trialCount: statisticalEvaluation.trialCount,
      passRate: 100,
      criticalOmissions: 0,
      minimumQualityScore: statisticalEvaluation.minimumQualityScore,
    },
    facts,
  };
}

export function buildControlDirectorStabilityProof(params: {
  sourceSha: string;
  generatedAt: string;
  evidenceRefs: readonly string[];
  monitoring: {
    activeSoakMinutes: number;
    passiveMonitorHours: number;
    routeDriftDetected: boolean;
    capabilityLossDetected: boolean;
  };
  restoration: {
    rollbackRestored: boolean;
    fallbackOrderRestored: boolean;
    cacheIdentityRestored: boolean;
    proofStateRestored: boolean;
  };
  facts: ReadonlyArray<ControlDirectorProofFact<ControlDirectorStabilityFactId>>;
}): ControlDirectorStabilityProof {
  const sourceSha = assertSha(params.sourceSha, "sourceSha");
  const facts = requireCompleteFactLedger(
    params.facts,
    CONTROL_DIRECTOR_STABILITY_FACT_IDS,
    "stabilityProof.facts",
  );
  if (
    params.monitoring.activeSoakMinutes < 30 ||
    params.monitoring.passiveMonitorHours < 24 ||
    params.monitoring.routeDriftDetected ||
    params.monitoring.capabilityLossDetected
  ) {
    throw new Error(
      "Stability monitoring must prove 30 active soak minutes and 24 passive clean hours.",
    );
  }
  if (
    !params.restoration.rollbackRestored ||
    !params.restoration.fallbackOrderRestored ||
    !params.restoration.cacheIdentityRestored ||
    !params.restoration.proofStateRestored
  ) {
    throw new Error(
      "Stability restoration must prove rollback, fallback order, cache identity, and proof state restoration.",
    );
  }
  return {
    schema: CONTROL_DIRECTOR_STABILITY_PROOF_SCHEMA,
    sourceSha,
    generatedAt: assertDate(params.generatedAt, "generatedAt"),
    passed: true,
    failedCritical: [],
    evidenceRefs: assertEvidenceRefs(params.evidenceRefs, "stabilityProof.evidenceRefs"),
    monitoring: {
      activeSoakMinutes: params.monitoring.activeSoakMinutes,
      passiveMonitorHours: params.monitoring.passiveMonitorHours,
      routeDriftDetected: false,
      capabilityLossDetected: false,
    },
    restoration: {
      rollbackRestored: true,
      fallbackOrderRestored: true,
      cacheIdentityRestored: true,
      proofStateRestored: true,
    },
    facts,
  };
}

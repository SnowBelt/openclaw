#!/usr/bin/env node
// Assemble a production-readiness receipt only from exact-SHA runtime evidence files.
import { createHash, createPublicKey } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { buildControlDirectorJudgeClaimHash } from "../src/agents/control-director-contract.js";
import {
  buildControlDirectorModelEvalMatrix,
  parseControlDirectorModelEvalTrials,
  type ControlDirectorModelEvalArtifactVerifier,
} from "../src/agents/control-director-model-eval.js";
import {
  buildControlDirectorCacheIdentityEvidence,
  CONTROL_DIRECTOR_STABILITY_SAMPLE_SCHEMA,
  digestControlDirectorStabilitySample,
  digestControlDirectorStabilitySamples,
  type ControlDirectorStabilitySampleBinding,
} from "../src/agents/control-director-model-governance-proof.js";
import { CONTROL_DIRECTOR_UX_SLOS } from "../src/agents/control-director-slos.js";
import type { IndependentJudgeReceipt } from "../src/agents/independent-judge-service.js";
import { verifyJudgeReceipt } from "../src/agents/judge-receipt-signer.js";
import { resolveStateDir } from "../src/config/paths.js";
import {
  CONTROL_DIRECTOR_CAPABILITY_IDS,
  CONTROL_DIRECTOR_CAPABILITY_OBSERVATION_SCHEMA,
  digestControlDirectorCapabilityObservation,
  verifyControlDirectorCapabilityObservation,
} from "./control-director-capability-observer.mjs";

const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const CAMPAIGN_JUDGE_PUBLIC_KEY_FILENAME = "judge-campaign-receipt-ed25519-public.pem";
const MINIMUM_SOAK_MS = 30 * 60_000;
const MAXIMUM_SOAK_SAMPLE_GAP_MS = 60_000;
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

function loadManagedJudgeTrust(publicKeyFilename = "judge-receipt-ed25519-public.pem"): {
  publicKeyPath: string;
  publicKeyPem: string;
  publicKeyId: string;
} {
  const publicKeyPath = path.join(resolveStateDir(), "credentials", publicKeyFilename);
  const descriptor = fs.openSync(
    publicKeyPath,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
  );
  let publicKeyPem: string;
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || (stat.mode & 0o022) !== 0) {
      throw new Error("Managed Judge trust file is missing or unsafe.");
    }
    publicKeyPem = fs.readFileSync(descriptor, "utf8");
  } finally {
    fs.closeSync(descriptor);
  }
  const publicKey = createPublicKey(publicKeyPem);
  const publicKeyId = createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex");
  return { publicKeyPath, publicKeyPem, publicKeyId };
}

type Surface = (typeof SURFACES)[number];
type JsonObject = Record<string, unknown>;
export type ControlDirectorJudgeClaimPacket = {
  missionId: string;
  requestBody: string;
  finalText: string;
  evidenceSummary: string;
  artifactIds: string[];
};
export type ControlDirectorSoakArtifactBinding = { path: string; sha256: string };
export type ControlDirectorSoakArtifactReader = (
  artifact: ControlDirectorSoakArtifactBinding,
) => Uint8Array | undefined;
export type ControlDirectorSoakCapabilityVerifier = (observation: JsonObject) => unknown;

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

function uniqueStrings(value: unknown, label: string): string[] {
  const values = strings(value).map((entry) => entry.trim());
  if (
    !Array.isArray(value) ||
    values.length === 0 ||
    values.length !== value.length ||
    new Set(values).size !== values.length
  ) {
    throw new Error(`${label} must contain unique non-empty strings.`);
  }
  return values;
}

function normalizedStringSet(values: readonly string[]): string[] {
  return [...new Set(values.map((entry) => entry.trim()).filter(Boolean))].toSorted((left, right) =>
    left.localeCompare(right),
  );
}

export function verifyControlDirectorJudgeEvidence(params: {
  evidence: JsonObject;
  publicKeyPem: string;
  expectedPublicKeyId: string;
  expectedJudgeAgentId?: string;
  disallowedJudgeAgentIds?: readonly string[];
  disallowedJudgeRunIds?: readonly string[];
  expectedMissionId?: string;
  expectedArtifactIds?: readonly string[];
  expectedSourceSha?: string;
  expectedRollbackSha?: string;
  expectedActiveReleaseId?: string;
  expectedRollbackReleaseId?: string;
  expectedConfigurationDigest?: string;
  expectedSelectedModel?: string;
  expectedSelectedModelIdentity?: { modelDigest: string; cacheDigest: string };
  expectedRuntimeHome?: string;
  notBefore?: number;
  notAfter?: number;
}): {
  receipt: IndependentJudgeReceipt;
  claim: ControlDirectorJudgeClaimPacket;
  modelProvider: string;
} {
  const claimValue = object(params.evidence.claim, "judge.claim");
  const receiptValue = object(params.evidence.receipt, "judge.receipt");
  const claim: ControlDirectorJudgeClaimPacket = {
    missionId: requiredString(claimValue.missionId, "judge.claim.missionId"),
    requestBody: requiredString(claimValue.requestBody, "judge.claim.requestBody"),
    finalText: requiredString(claimValue.finalText, "judge.claim.finalText"),
    evidenceSummary: requiredString(claimValue.evidenceSummary, "judge.claim.evidenceSummary"),
    artifactIds: uniqueStrings(claimValue.artifactIds, "judge.claim.artifactIds"),
  };
  const receipt = receiptValue as unknown as IndependentJudgeReceipt;
  if (
    receipt.schemaVersion !== 1 ||
    receipt.verdict !== "APPROVE" ||
    !requiredString(receipt.receiptId, "judge.receipt.receiptId") ||
    !requiredString(receipt.missionId, "judge.receipt.missionId") ||
    !requiredString(receipt.claimHash, "judge.receipt.claimHash") ||
    !requiredString(receipt.scope, "judge.receipt.scope") ||
    !requiredString(receipt.evidenceSummary, "judge.receipt.evidenceSummary") ||
    !requiredString(receipt.conditions, "judge.receipt.conditions")
  ) {
    throw new Error("Judge receipt is not an approving signed v1 decision.");
  }
  const judgeRunId = requiredString(receipt.judgeRunId, "judge.receipt.judgeRunId");
  const judgeAgentId = requiredString(receipt.judgeAgentId, "judge.receipt.judgeAgentId");
  const model = requiredString(receipt.model, "judge.receipt.model");
  if (
    judgeRunId === "not-run" ||
    judgeAgentId === "unavailable" ||
    !model.includes("/") ||
    !Number.isFinite(receipt.issuedAt)
  ) {
    throw new Error("Judge receipt requires a completed provider-qualified independent run.");
  }
  const claimHash = buildControlDirectorJudgeClaimHash(claim);
  if (receipt.missionId !== claim.missionId || receipt.claimHash !== claimHash) {
    throw new Error("Judge receipt does not bind the exact completion claim.");
  }
  if (params.expectedMissionId && claim.missionId !== params.expectedMissionId) {
    throw new Error("Judge receipt mission does not match the Pursue Goal mission.");
  }
  if (
    params.expectedArtifactIds &&
    normalizedStringSet(claim.artifactIds).join("\n") !==
      normalizedStringSet(params.expectedArtifactIds).join("\n")
  ) {
    throw new Error("Judge receipt artifacts do not match the Pursue Goal artifacts.");
  }
  if (
    receipt.publicKeyId !== params.expectedPublicKeyId ||
    !SHA256_PATTERN.test(params.expectedPublicKeyId) ||
    !verifyJudgeReceipt(receiptValue, {
      publicKeyPem: params.publicKeyPem,
      certificationAt: params.notAfter,
      expectedRuntimeHome: params.expectedRuntimeHome,
    })
  ) {
    throw new Error("Judge receipt signature does not match the trusted public key.");
  }
  const issuance = receipt.campaignIssuance;
  if (
    !issuance ||
    issuance.purpose !== "control-director-m01-m106" ||
    issuance.claimHash !== claimHash ||
    issuance.sourceSha !== params.expectedSourceSha ||
    issuance.rollbackSha !== params.expectedRollbackSha ||
    issuance.activeReleaseId !== params.expectedActiveReleaseId ||
    issuance.rollbackReleaseId !== params.expectedRollbackReleaseId ||
    issuance.configurationDigest !== params.expectedConfigurationDigest ||
    issuance.selectedModel !== params.expectedSelectedModel ||
    !SHA256_PATTERN.test(issuance.selectedModelIdentity?.modelDigest ?? "") ||
    !SHA256_PATTERN.test(issuance.selectedModelIdentity?.cacheDigest ?? "") ||
    !SHA256_PATTERN.test(issuance.judgeModelIdentity?.modelDigest ?? "") ||
    !SHA256_PATTERN.test(issuance.judgeModelIdentity?.cacheDigest ?? "") ||
    issuance.selectedModelIdentity.modelDigest === issuance.judgeModelIdentity.modelDigest ||
    issuance.selectedModelIdentity.cacheDigest === issuance.judgeModelIdentity.cacheDigest ||
    (params.expectedSelectedModelIdentity !== undefined &&
      JSON.stringify(issuance.selectedModelIdentity) !==
        JSON.stringify(params.expectedSelectedModelIdentity)) ||
    issuance.certificationLease.runtimeHome !== params.expectedRuntimeHome ||
    normalizedStringSet(issuance.evidenceArtifacts.map((artifact) => artifact.artifactId)).join(
      "\n",
    ) !== normalizedStringSet(claim.artifactIds).join("\n")
  ) {
    throw new Error("Judge receipt lacks exact service-issued M01-M106 campaign provenance.");
  }
  if (
    (params.notBefore !== undefined && receipt.issuedAt < params.notBefore) ||
    (params.notAfter !== undefined && receipt.issuedAt > params.notAfter)
  ) {
    throw new Error("Judge receipt was issued outside the exact runtime evidence window.");
  }
  if (params.expectedJudgeAgentId && judgeAgentId !== params.expectedJudgeAgentId) {
    throw new Error("Judge receipt agent does not match the configured Judge identity.");
  }
  if (params.disallowedJudgeAgentIds?.includes(judgeAgentId)) {
    throw new Error("Judge receipt reuses a non-independent operational agent.");
  }
  if (params.disallowedJudgeRunIds?.includes(judgeRunId)) {
    throw new Error("Judge receipt reuses a delegation run identity.");
  }
  return {
    receipt,
    claim,
    modelProvider: model.slice(0, model.indexOf("/")),
  };
}

function finiteNonNegative(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} requires a non-negative finite number.`);
  }
  return value;
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalJson(entry)]),
    );
  }
  return value;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

function containedArtifactBinding(
  value: unknown,
  label: string,
): ControlDirectorSoakArtifactBinding {
  const binding = object(value, label);
  const artifactPath = requiredString(binding.path, `${label}.path`).replaceAll("\\", "/");
  const sha256 = requiredString(binding.sha256, `${label}.sha256`).toLowerCase();
  if (
    path.isAbsolute(artifactPath) ||
    /^[A-Za-z]:\//u.test(artifactPath) ||
    artifactPath.split("/").includes("..")
  ) {
    throw new Error(`${label}.path must be a contained relative artifact path.`);
  }
  if (!SHA256_PATTERN.test(sha256)) {
    throw new Error(`${label}.sha256 must be a 64-character SHA-256 digest.`);
  }
  return { path: artifactPath, sha256 };
}

function readVerifiedSoakArtifact(params: {
  binding: unknown;
  label: string;
  readArtifact: ControlDirectorSoakArtifactReader;
  seenPaths: Set<string>;
  expectedJson?: unknown;
}): unknown {
  const binding = containedArtifactBinding(params.binding, params.label);
  if (params.seenPaths.has(binding.path)) {
    throw new Error(`soak artifact path ${binding.path} is reused.`);
  }
  params.seenPaths.add(binding.path);
  const bytes = params.readArtifact(binding);
  if (!bytes || createHash("sha256").update(bytes).digest("hex") !== binding.sha256) {
    throw new Error(`${params.label} failed digest-bound artifact verification.`);
  }
  if (params.expectedJson === undefined) {
    return bytes;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new Error(`${params.label} is not replayable JSON evidence.`);
  }
  if (!sameJson(parsed, params.expectedJson)) {
    throw new Error(`${params.label} artifact does not bind its embedded receipt.`);
  }
  return parsed;
}

export function verifyControlDirectorRuntimeSoak(params: {
  evidence: JsonObject;
  expected: {
    sourceSha: string;
    activeReleaseId: string;
    configurationDigest: string;
    selectedModel: string;
    invocationId: string;
    notBefore: string;
    notAfter: string;
  };
  readArtifact: ControlDirectorSoakArtifactReader;
  verifyCapabilityObservation: ControlDirectorSoakCapabilityVerifier;
}): JsonObject {
  validateSurface("soak", params.evidence, params.expected.sourceSha);
  if (
    !SHA_PATTERN.test(params.expected.sourceSha) ||
    !SHA256_PATTERN.test(params.expected.configurationDigest)
  ) {
    throw new Error("soak verification requires exact source and configuration identities.");
  }
  const notBeforeMs = Date.parse(params.expected.notBefore);
  const notAfterMs = Date.parse(params.expected.notAfter);
  if (!Number.isFinite(notBeforeMs) || !Number.isFinite(notAfterMs) || notAfterMs < notBeforeMs) {
    throw new Error("soak verification requires a bounded certification window.");
  }
  const rawSamples = params.evidence.samples;
  if (!Array.isArray(rawSamples) || rawSamples.length < 2) {
    throw new Error("soak evidence requires replayable stability sample bindings.");
  }

  const seenPaths = new Set<string>();
  const seenTimes = new Set<number>();
  const samples = rawSamples.map((rawSample, index) => {
    const label = `soak.samples[${index}]`;
    const bindingValue = object(rawSample, label);
    const receipt = object(bindingValue.receipt, `${label}.receipt`);
    const binding = containedArtifactBinding(bindingValue, label);
    readVerifiedSoakArtifact({
      binding,
      label,
      readArtifact: params.readArtifact,
      seenPaths,
      expectedJson: receipt,
    });
    const checkedAt = requiredString(receipt.checkedAt, `${label}.receipt.checkedAt`);
    const checkedAtMs = Date.parse(checkedAt);
    if (!Number.isFinite(checkedAtMs) || seenTimes.has(checkedAtMs)) {
      throw new Error("soak sample timestamps must be valid and unique.");
    }
    seenTimes.add(checkedAtMs);
    if (
      receipt.schema !== CONTROL_DIRECTOR_STABILITY_SAMPLE_SCHEMA ||
      receipt.mode !== "active" ||
      receipt.sourceSha !== params.expected.sourceSha ||
      receipt.activeReleaseId !== params.expected.activeReleaseId ||
      receipt.selectedModel !== params.expected.selectedModel ||
      receipt.configDigest !== params.expected.configurationDigest ||
      receipt.gatewayHealthy !== true ||
      receipt.capabilitiesPassed !== CONTROL_DIRECTOR_CAPABILITY_IDS.length ||
      receipt.routeDriftDetected !== false ||
      receipt.capabilityLossDetected !== false
    ) {
      throw new Error(`${label} is not a healthy exact-runtime active sample.`);
    }

    const cacheBinding = object(receipt.cacheEvidence, `${label}.receipt.cacheEvidence`);
    const cacheEvidence = object(cacheBinding.receipt, `${label}.receipt.cacheEvidence.receipt`);
    readVerifiedSoakArtifact({
      binding: cacheBinding,
      label: `${label}.receipt.cacheEvidence`,
      readArtifact: params.readArtifact,
      seenPaths,
      expectedJson: cacheEvidence,
    });
    const capture = object(cacheEvidence.capture, `${label}.receipt.cacheEvidence.receipt.capture`);
    const transcripts = object(
      capture.transcripts,
      `${label}.receipt.cacheEvidence.receipt.capture.transcripts`,
    );
    const requiredTranscripts = [
      "config",
      "lifecycle",
      "ollamaLaunchctl",
      "ollamaList",
      "ollamaModelfile",
      "ollamaPs",
    ];
    if (
      capture.schema !== "openclaw.control-director-runtime-identity-capture.v1" ||
      capture.phase !== "restored" ||
      capture.sourceSha !== params.expected.sourceSha ||
      capture.activeReleaseId !== params.expected.activeReleaseId ||
      capture.configDigest !== params.expected.configurationDigest ||
      capture.invocationId !== params.expected.invocationId ||
      !SHA256_PATTERN.test(requiredString(capture.transitionId, `${label}.capture.transitionId`)) ||
      JSON.stringify(Object.keys(transcripts).toSorted()) !== JSON.stringify(requiredTranscripts)
    ) {
      throw new Error(`${label} cache capture is not bound to the exact restored runtime.`);
    }
    const capturedAtMs = Date.parse(
      requiredString(capture.capturedAt, `${label}.capture.capturedAt`),
    );
    if (
      !Number.isFinite(capturedAtMs) ||
      capturedAtMs > checkedAtMs ||
      checkedAtMs - capturedAtMs > 300_000
    ) {
      throw new Error(`${label} cache capture is stale or postdates the sample.`);
    }
    for (const transcriptName of requiredTranscripts) {
      readVerifiedSoakArtifact({
        binding: transcripts[transcriptName],
        label: `${label}.capture.transcripts.${transcriptName}`,
        readArtifact: params.readArtifact,
        seenPaths,
      });
    }
    const rebuiltCache = buildControlDirectorCacheIdentityEvidence({
      selectedModel: requiredString(cacheEvidence.selectedModel, `${label}.cache.selectedModel`),
      modelId: requiredString(cacheEvidence.modelId, `${label}.cache.modelId`),
      modelDigest: requiredString(cacheEvidence.modelDigest, `${label}.cache.modelDigest`),
      manifestDigest: requiredString(cacheEvidence.manifestDigest, `${label}.cache.manifestDigest`),
      baseBlobDigests: uniqueStrings(
        cacheEvidence.baseBlobDigests,
        `${label}.cache.baseBlobDigests`,
      ),
      kvCacheType: requiredString(cacheEvidence.kvCacheType, `${label}.cache.kvCacheType`),
      residency: {
        modelId: requiredString(cacheEvidence.residentModelId, `${label}.cache.residentModelId`),
        digest: requiredString(cacheEvidence.residentDigest, `${label}.cache.residentDigest`),
        sizeBytes: finiteNonNegative(
          cacheEvidence.residentSizeBytes,
          `${label}.cache.residentSizeBytes`,
        ),
        vramBytes: finiteNonNegative(
          cacheEvidence.residentVramBytes,
          `${label}.cache.residentVramBytes`,
        ),
      },
    });
    if (
      rebuiltCache.selectedModel !== params.expected.selectedModel ||
      rebuiltCache.cacheDigest !== receipt.cacheDigest ||
      rebuiltCache.cacheDigest !== cacheEvidence.cacheDigest
    ) {
      throw new Error(`${label} cache identity drifted during the soak.`);
    }

    const observationBinding = object(
      receipt.capabilityObservation,
      `${label}.receipt.capabilityObservation`,
    );
    const observation = object(
      observationBinding.receipt,
      `${label}.receipt.capabilityObservation.receipt`,
    );
    readVerifiedSoakArtifact({
      binding: observationBinding,
      label: `${label}.receipt.capabilityObservation`,
      readArtifact: params.readArtifact,
      seenPaths,
      expectedJson: observation,
    });
    const verifiedObservation = params.verifyCapabilityObservation(observation);
    if (!sameJson(verifiedObservation, observation)) {
      throw new Error(`${label} capability verifier did not replay the bound observation.`);
    }
    const capabilities = Array.isArray(observation.capabilities) ? observation.capabilities : [];
    const capabilityIds = capabilities
      .map((capability, capabilityIndex) =>
        requiredString(
          object(capability, `${label}.capabilities[${capabilityIndex}]`).id,
          `${label}.capabilities[${capabilityIndex}].id`,
        ),
      )
      .toSorted((left, right) => left.localeCompare(right));
    if (
      observation.schema !== CONTROL_DIRECTOR_CAPABILITY_OBSERVATION_SCHEMA ||
      observation.phase !== "restored" ||
      observation.sourceSha !== params.expected.sourceSha ||
      observation.releaseId !== params.expected.activeReleaseId ||
      observation.selectedModelId !== params.expected.selectedModel.replace(/^ollama\//u, "") ||
      observation.checkedAt !== checkedAt ||
      !Array.isArray(observation.configurationDigests) ||
      observation.configurationDigests[0] !== params.expected.configurationDigest ||
      JSON.stringify(capabilityIds) !== JSON.stringify(CONTROL_DIRECTOR_CAPABILITY_IDS) ||
      digestControlDirectorCapabilityObservation(observation) !== observation.contentSha256 ||
      observation.contentSha256 !== receipt.capabilityObservationSha256
    ) {
      throw new Error(`${label} capability observation is not exact-runtime health evidence.`);
    }

    const normalized = {
      path: binding.path,
      sha256: binding.sha256,
      receipt,
    };
    const sampleDigest = requiredString(bindingValue.sampleDigest, `${label}.sampleDigest`);
    if (
      !SHA256_PATTERN.test(sampleDigest) ||
      sampleDigest !==
        digestControlDirectorStabilitySample(
          normalized as unknown as Omit<ControlDirectorStabilitySampleBinding, "sampleDigest">,
        )
    ) {
      throw new Error(`${label} sample digest does not replay.`);
    }
    return {
      path: normalized.path,
      sha256: normalized.sha256,
      receipt: normalized.receipt,
      sampleDigest,
    } as unknown as ControlDirectorStabilitySampleBinding;
  });

  samples.sort(
    (left, right) => Date.parse(left.receipt.checkedAt) - Date.parse(right.receipt.checkedAt),
  );
  for (const [index, sample] of samples.entries()) {
    if (
      index > 0 &&
      object(sample.receipt.capabilityObservation.receipt, "capabilityObservation")
        .previousObservationSha256 !== samples[index - 1]!.receipt.capabilityObservationSha256
    ) {
      throw new Error("soak capability observations do not form a continuous digest chain.");
    }
  }
  const startedAt = samples[0]!.receipt.checkedAt;
  const endedAt = samples.at(-1)!.receipt.checkedAt;
  const startedAtMs = Date.parse(startedAt);
  const endedAtMs = Date.parse(endedAt);
  const durationMs = endedAtMs - startedAtMs;
  const maximumSamplingGapMs = samples
    .slice(1)
    .reduce(
      (maximum, sample, index) =>
        Math.max(
          maximum,
          Date.parse(sample.receipt.checkedAt) - Date.parse(samples[index]!.receipt.checkedAt),
        ),
      0,
    );
  const sampleSetDigest = digestControlDirectorStabilitySamples(samples);
  if (
    startedAtMs < notBeforeMs ||
    endedAtMs > notAfterMs ||
    durationMs < MINIMUM_SOAK_MS ||
    maximumSamplingGapMs > MAXIMUM_SOAK_SAMPLE_GAP_MS
  ) {
    throw new Error(
      "soak samples must prove 30 continuous minutes within the certification window with gaps no larger than 60000ms.",
    );
  }
  if (
    params.evidence.startedAt !== startedAt ||
    params.evidence.endedAt !== endedAt ||
    params.evidence.checkedAt !== endedAt ||
    params.evidence.durationMs !== durationMs ||
    params.evidence.maximumSamplingGapMs !== maximumSamplingGapMs ||
    params.evidence.sampleCount !== samples.length ||
    params.evidence.sampleSetDigest !== sampleSetDigest ||
    !samples.every((sample) => strings(params.evidence.evidenceRefs).includes(sample.path))
  ) {
    throw new Error("soak summary does not replay from its digest-bound sample artifacts.");
  }
  const first = samples[0]!.receipt;
  if (samples.some((sample) => sample.receipt.cacheDigest !== first.cacheDigest)) {
    throw new Error("soak samples changed cache identity.");
  }
  return {
    ...params.evidence,
    passed: true,
    sourceSha: params.expected.sourceSha,
    startedAt,
    endedAt,
    checkedAt: endedAt,
    durationMs,
    maximumSamplingGapMs,
    sampleCount: samples.length,
    sampleSetDigest,
    activeReleaseId: params.expected.activeReleaseId,
    selectedModel: params.expected.selectedModel,
    configurationDigest: params.expected.configurationDigest,
    cacheDigest: first.cacheDigest,
    modelDigest: requiredString(
      object(first.cacheEvidence.receipt, "soak first cache evidence").modelDigest,
      "soak first cache evidence.modelDigest",
    ),
    routeDriftDetected: false,
    capabilityLossDetected: false,
    samples,
  };
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
      object(value.claim, "judge.claim");
      object(value.receipt, "judge.receipt");
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
      requiredString(value.missionId, "pursueGoal.missionId");
      uniqueStrings(value.artifactIds, "pursueGoal.artifactIds");
      if (!Number.isFinite(Date.parse(requiredString(value.startedAt, "pursueGoal.startedAt")))) {
        throw new Error("pursueGoal.startedAt must be a valid timestamp.");
      }
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
}

export function buildControlDirectorRuntimeProof(params: {
  sourceSha: string;
  lineageReceipt: JsonObject;
  modelEval: JsonObject;
  verifyModelEvalArtifact: ControlDirectorModelEvalArtifactVerifier;
  readSoakArtifact: ControlDirectorSoakArtifactReader;
  verifySoakCapabilityObservation: ControlDirectorSoakCapabilityVerifier;
  judgePublicKeyPem: string;
  expectedJudgePublicKeyId: string;
  campaignJudgePublicKeyPem: string;
  expectedCampaignJudgePublicKeyId: string;
  expectedJudgeAgentId: string;
  certification: {
    runtimeHome: string;
    rollbackSha: string;
    activeReleaseId: string;
    rollbackReleaseId: string;
    configurationDigest: string;
    leaseOwner: string;
    approvalId: string;
    operationId: string;
    invocationId: string;
    leaseAcquiredAt: string;
  };
  surfaces: Record<Surface, JsonObject>;
  artifacts?: Record<string, { path: string; sha256: string }>;
  generatedAt?: string;
}): JsonObject {
  const sourceSha = params.sourceSha.trim().toLowerCase();
  if (!SHA_PATTERN.test(sourceSha)) {
    throw new Error("sourceSha must be an immutable 40-character SHA.");
  }
  if (
    !SHA_PATTERN.test(params.certification.rollbackSha) ||
    !SHA256_PATTERN.test(params.certification.configurationDigest) ||
    !path.isAbsolute(params.certification.runtimeHome) ||
    !SHA256_PATTERN.test(params.expectedCampaignJudgePublicKeyId) ||
    params.expectedCampaignJudgePublicKeyId === params.expectedJudgePublicKeyId
  ) {
    throw new Error(
      "certification requires exact rollback, configuration, and distinct Judge trust identities.",
    );
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
  if (params.modelEval.configurationDigest !== params.certification.configurationDigest) {
    throw new Error("model evaluation configuration digest does not match certification.");
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
  exactSha(params.modelEval.sourceSha, sourceSha, "modelEval");
  const modelIdentityValue = object(params.modelEval.modelIdentity, "modelEval.modelIdentity");
  const modelDigest = modelIdentityValue.modelDigest;
  const cacheDigest = modelIdentityValue.cacheDigest;
  if (
    typeof params.modelEval.evaluatedAt !== "string" ||
    !Number.isFinite(Date.parse(params.modelEval.evaluatedAt)) ||
    Date.parse(params.modelEval.evaluatedAt) > generatedAtMs
  ) {
    throw new Error("model evaluation requires an evaluatedAt timestamp at or before generatedAt.");
  }
  if (
    params.modelEval.schemaVersion !== 1 ||
    typeof params.modelEval.configurationDigest !== "string" ||
    !SHA256_PATTERN.test(params.modelEval.configurationDigest) ||
    typeof params.modelEval.modelRef !== "string" ||
    !params.modelEval.modelRef.includes("/") ||
    typeof modelDigest !== "string" ||
    !SHA256_PATTERN.test(modelDigest) ||
    typeof cacheDigest !== "string" ||
    !SHA256_PATTERN.test(cacheDigest) ||
    typeof params.modelEval.trialReceiptSetDigest !== "string" ||
    !SHA256_PATTERN.test(params.modelEval.trialReceiptSetDigest) ||
    params.modelEval.passed !== true ||
    params.modelEval.exactRuntime !== true ||
    params.modelEval.passRate !== 100 ||
    params.modelEval.criticalOmissions !== 0 ||
    params.modelEval.coveragePassed !== true
  ) {
    throw new Error(
      "model evaluation requires 100% pass rate, full coverage, and zero critical omissions.",
    );
  }
  const modelResults = Array.isArray(params.modelEval.results) ? params.modelEval.results : [];
  const modelIdentity = { modelDigest, cacheDigest };
  const parsedTrials = parseControlDirectorModelEvalTrials(
    modelResults.map((entry, index) => object(entry, `modelEval.results[${index}]`).trial),
  );
  const recomputedModelEval = buildControlDirectorModelEvalMatrix({
    trials: parsedTrials,
    sourceSha,
    configurationDigest: params.modelEval.configurationDigest,
    modelRef: params.modelEval.modelRef,
    modelIdentity,
    evaluatedAt: params.modelEval.evaluatedAt,
    verifyArtifact: params.verifyModelEvalArtifact,
    certification: {
      ...params.certification,
      judgeAgentId: params.expectedJudgeAgentId,
      judgePublicKeyPem: params.judgePublicKeyPem,
      judgePublicKeyId: params.expectedJudgePublicKeyId,
    },
  });
  if (
    !recomputedModelEval.passed ||
    recomputedModelEval.results.length < 48 ||
    recomputedModelEval.trialReceiptSetDigest !== params.modelEval.trialReceiptSetDigest ||
    recomputedModelEval.results.some((result) => !result.provenanceVerified)
  ) {
    throw new Error(
      "model evaluation trial receipts are not independently digest-bound exact-runtime evidence.",
    );
  }
  const routedModel = object(params.surfaces.localModelRouting, "localModelRouting").modelRef;
  if (params.modelEval.modelRef !== routedModel) {
    throw new Error("model evaluation model does not match localModelRouting.modelRef.");
  }
  for (const surface of SURFACES) {
    validateSurface(surface, params.surfaces[surface], sourceSha);
    if (Date.parse(params.surfaces[surface].checkedAt as string) > generatedAtMs) {
      throw new Error(`${surface} evidence cannot postdate generatedAt.`);
    }
  }
  const verifiedSoak = verifyControlDirectorRuntimeSoak({
    evidence: params.surfaces.soak,
    expected: {
      sourceSha,
      activeReleaseId: params.certification.activeReleaseId,
      configurationDigest: params.certification.configurationDigest,
      selectedModel: params.modelEval.modelRef as string,
      invocationId: params.certification.invocationId,
      notBefore: params.certification.leaseAcquiredAt,
      notAfter: generatedAt,
    },
    readArtifact: params.readSoakArtifact,
    verifyCapabilityObservation: params.verifySoakCapabilityObservation,
  });
  if (
    verifiedSoak.modelDigest !== modelIdentity.modelDigest ||
    verifiedSoak.cacheDigest !== modelIdentity.cacheDigest
  ) {
    throw new Error("Model evaluation identity does not match the replayed soak identity.");
  }
  const pursueGoal = params.surfaces.pursueGoal;
  const delegation = params.surfaces.delegation;
  const judgeVerification = verifyControlDirectorJudgeEvidence({
    evidence: params.surfaces.judge,
    publicKeyPem: params.campaignJudgePublicKeyPem,
    expectedPublicKeyId: params.expectedCampaignJudgePublicKeyId,
    expectedJudgeAgentId: params.expectedJudgeAgentId,
    disallowedJudgeRunIds: [
      requiredString(delegation.controlDirectorRunId, "delegation.controlDirectorRunId"),
      requiredString(delegation.programManagerRunId, "delegation.programManagerRunId"),
      requiredString(delegation.workerRunId, "delegation.workerRunId"),
    ],
    expectedMissionId: requiredString(pursueGoal.missionId, "pursueGoal.missionId"),
    expectedArtifactIds: uniqueStrings(pursueGoal.artifactIds, "pursueGoal.artifactIds"),
    expectedSourceSha: sourceSha,
    expectedRollbackSha: params.certification.rollbackSha,
    expectedActiveReleaseId: params.certification.activeReleaseId,
    expectedRollbackReleaseId: params.certification.rollbackReleaseId,
    expectedConfigurationDigest: params.certification.configurationDigest,
    expectedSelectedModel: params.modelEval.modelRef as string,
    expectedSelectedModelIdentity: modelIdentity,
    expectedRuntimeHome: params.certification.runtimeHome,
    notBefore: Date.parse(requiredString(pursueGoal.startedAt, "pursueGoal.startedAt")),
    notAfter: Date.parse(requiredString(pursueGoal.checkedAt, "pursueGoal.checkedAt")),
  });
  return {
    schemaVersion: 4,
    sourceSha,
    generatedAt,
    sigBackgroundEnabled: params.surfaces.sig.backgroundEnabled,
    lineage: {
      ...lineage,
      checkedAt: params.lineageReceipt.checkedAt,
      evidenceRefs: strings(params.lineageReceipt.evidenceRefs),
    },
    modelEval: params.modelEval,
    certification: {
      ...params.certification,
      judgeAgentId: params.expectedJudgeAgentId,
      judgePublicKeyId: params.expectedJudgePublicKeyId,
      campaignJudgePublicKeyId: params.expectedCampaignJudgePublicKeyId,
    },
    ...params.surfaces,
    soak: verifiedSoak,
    judgeVerification: {
      publicKeyId: judgeVerification.receipt.publicKeyId,
      judgeAgentId: judgeVerification.receipt.judgeAgentId,
      judgeRunId: judgeVerification.receipt.judgeRunId,
      judgeModel: judgeVerification.receipt.model,
      judgeProvider: judgeVerification.modelProvider,
      claimHash: judgeVerification.receipt.claimHash,
      selectedModelIdentity: judgeVerification.receipt.campaignIssuance?.selectedModelIdentity,
      judgeModelIdentity: judgeVerification.receipt.campaignIssuance?.judgeModelIdentity,
    },
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
  const required = [
    "source-sha",
    "runtime-home",
    "rollback-sha",
    "configuration-digest",
    "lineage",
    "model-eval",
    "model-eval-artifact-root",
    "soak-artifact-root",
    "expected-judge-agent-id",
    "expected-campaign-judge-public-key-id",
    "active-release-id",
    "rollback-release-id",
    "lease-owner",
    "approval-id",
    "operation-id",
    "invocation-id",
    "lease-acquired-at",
    ...SURFACES,
    "output",
  ];
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
  const modelEvalArtifactRoot = path.resolve(args.get("model-eval-artifact-root")!);
  const soakArtifactRootInput = path.resolve(args.get("soak-artifact-root")!);
  if (fs.lstatSync(soakArtifactRootInput).isSymbolicLink()) {
    throw new Error("Soak artifact root must not be a symbolic link.");
  }
  const soakArtifactRoot = fs.realpathSync(soakArtifactRootInput);
  const managedJudgeTrust = loadManagedJudgeTrust();
  const managedCampaignJudgeTrust = loadManagedJudgeTrust(CAMPAIGN_JUDGE_PUBLIC_KEY_FILENAME);
  const expectedCampaignJudgePublicKeyId = args.get("expected-campaign-judge-public-key-id")!;
  if (
    !SHA256_PATTERN.test(expectedCampaignJudgePublicKeyId) ||
    managedCampaignJudgeTrust.publicKeyId !== expectedCampaignJudgePublicKeyId ||
    expectedCampaignJudgePublicKeyId === managedJudgeTrust.publicKeyId
  ) {
    throw new Error("Managed campaign Judge trust does not match the authorized distinct key ID.");
  }
  const proof = buildControlDirectorRuntimeProof({
    sourceSha,
    lineageReceipt: readJson(inputPaths.lineage!),
    modelEval: readJson(inputPaths.modelEval!),
    judgePublicKeyPem: managedJudgeTrust.publicKeyPem,
    expectedJudgePublicKeyId: managedJudgeTrust.publicKeyId,
    campaignJudgePublicKeyPem: managedCampaignJudgeTrust.publicKeyPem,
    expectedCampaignJudgePublicKeyId,
    expectedJudgeAgentId: args.get("expected-judge-agent-id")!,
    certification: {
      runtimeHome: path.resolve(args.get("runtime-home")!),
      rollbackSha: args.get("rollback-sha")!,
      activeReleaseId: args.get("active-release-id")!,
      rollbackReleaseId: args.get("rollback-release-id")!,
      configurationDigest: args.get("configuration-digest")!,
      leaseOwner: args.get("lease-owner")!,
      approvalId: args.get("approval-id")!,
      operationId: args.get("operation-id")!,
      invocationId: args.get("invocation-id")!,
      leaseAcquiredAt: args.get("lease-acquired-at")!,
    },
    verifyModelEvalArtifact: (artifact) => {
      const candidate = path.resolve(modelEvalArtifactRoot, artifact.path);
      const relative = path.relative(modelEvalArtifactRoot, candidate);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        return false;
      }
      try {
        return (
          fs.statSync(candidate).isFile() &&
          createHash("sha256").update(fs.readFileSync(candidate)).digest("hex") === artifact.sha256
        );
      } catch {
        return false;
      }
    },
    readSoakArtifact: (artifact) => {
      const candidate = path.resolve(soakArtifactRoot, artifact.path);
      const relative = path.relative(soakArtifactRoot, candidate);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        return undefined;
      }
      try {
        const stat = fs.lstatSync(candidate);
        if (stat.isSymbolicLink() || !stat.isFile()) {
          return undefined;
        }
        return fs.readFileSync(candidate);
      } catch {
        return undefined;
      }
    },
    verifySoakCapabilityObservation: (observation) =>
      verifyControlDirectorCapabilityObservation(observation),
    surfaces,
    artifacts: Object.fromEntries(
      Object.entries({
        ...inputPaths,
        judgePublicKey: managedJudgeTrust.publicKeyPath,
        campaignJudgePublicKey: managedCampaignJudgeTrust.publicKeyPath,
      }).map(([name, filePath]) => [name, { path: filePath, sha256: digest(filePath) }]),
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

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CONTROL_DIRECTOR_CAPABILITY_IDS,
  CONTROL_DIRECTOR_CAPABILITY_OBSERVATION_SCHEMA,
  digestControlDirectorCapabilityObservation,
} from "../../scripts/control-director-capability-observer.mjs";
import {
  buildControlDirectorRuntimeProof,
  verifyControlDirectorRuntimeSoak,
} from "../../scripts/control-director-runtime-proof.js";
import { buildControlDirectorJudgeClaimHash } from "../../src/agents/control-director-contract.js";
import {
  buildControlDirectorModelEvalCampaignNonce,
  buildControlDirectorModelEvalTrialSignedPayload,
  buildControlDirectorModelEvalMatrix,
  buildControlDirectorModelTrialJudgeClaim,
  CONTROL_DIRECTOR_MODEL_EVAL_TRIAL_RECEIPT_SCHEMA,
  digestControlDirectorModelEvalTrialMeasurementReceipt,
  digestControlDirectorModelEvalTrialReceipt,
  digestControlDirectorModelTrialEvidenceSet,
  digestControlDirectorModelTrialMeasurementSet,
  type ControlDirectorModelEvalTrial,
} from "../../src/agents/control-director-model-eval.js";
import {
  buildControlDirectorCacheIdentityEvidence,
  digestControlDirectorStabilitySample,
  digestControlDirectorStabilitySamples,
  type ControlDirectorStabilitySampleBinding,
} from "../../src/agents/control-director-model-governance-proof.js";
import { parseJudgeCompletionVerdict } from "../../src/agents/judge-gate.js";
import {
  canonicalJudgeReceiptBytes,
  digestCertificationLeaseEpoch,
} from "../../src/agents/judge-receipt-signer.js";

const sourceSha = "a".repeat(40);
const rollbackSha = "b".repeat(40);
const checkedAt = "2026-07-21T00:05:02.000Z";
const configurationDigest = "d".repeat(64);
const modelRef = "ollama/openclaw-control-qwen25-32b:latest";
const runtimeModelCacheEvidence = buildControlDirectorCacheIdentityEvidence({
  selectedModel: modelRef,
  modelId: modelRef.replace(/^ollama\//u, ""),
  modelDigest: "1".repeat(64),
  manifestDigest: "2".repeat(64),
  baseBlobDigests: ["3".repeat(64)],
  kvCacheType: "q8_0",
  residency: {
    modelId: modelRef.replace(/^ollama\//u, ""),
    digest: "2".repeat(64),
    sizeBytes: 32_000_000_000,
    vramBytes: 24_000_000_000,
  },
});
const selectedModelIdentity = {
  modelDigest: runtimeModelCacheEvidence.modelDigest,
  cacheDigest: runtimeModelCacheEvidence.cacheDigest,
};
const judgeModelIdentity = {
  modelDigest: "8".repeat(64),
  cacheDigest: "9".repeat(64),
};
const judgeKeyPair = crypto.generateKeyPairSync("ed25519");
const judgePublicKeyPem = judgeKeyPair.publicKey.export({ type: "spki", format: "pem" });
const judgePublicKeyId = crypto
  .createHash("sha256")
  .update(judgeKeyPair.publicKey.export({ type: "spki", format: "der" }))
  .digest("hex");
const campaignJudgeKeyPair = crypto.generateKeyPairSync("ed25519");
const campaignJudgePublicKeyPem = campaignJudgeKeyPair.publicKey.export({
  type: "spki",
  format: "pem",
});
const campaignJudgePublicKeyId = crypto
  .createHash("sha256")
  .update(campaignJudgeKeyPair.publicKey.export({ type: "spki", format: "der" }))
  .digest("hex");
const originalRuntimeHome = process.env.OPENCLAW_CUSTOM_RUNTIME_HOME;
const runtimeHome = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-runtime-proof-lease-"));
const certification = {
  runtimeHome,
  rollbackSha,
  activeReleaseId: "active-release",
  rollbackReleaseId: "rollback-release",
  configurationDigest,
  leaseOwner: "lease-owner",
  approvalId: "approval-id",
  operationId: "operation-id",
  invocationId: "invocation-id",
  leaseAcquiredAt: "2026-07-20T23:29:00.000Z",
};
const leasePayload = {
  schema: "openclaw.custom-runtime-certification-lease.v2",
  state: "acquired",
  activeSha: sourceSha,
  candidateSha: sourceSha,
  rollbackSha: "b".repeat(40),
  activeReleaseId: certification.activeReleaseId,
  rollbackReleaseId: certification.rollbackReleaseId,
  owner: certification.leaseOwner,
  approvalId: certification.approvalId,
  operationId: certification.operationId,
  invocationId: certification.invocationId,
  operationClass: "release-certification",
  createdAt: certification.leaseAcquiredAt,
  expiresAt: "2026-07-21T23:29:00.000Z",
  heartbeatAt: "2026-07-21T00:04:30.000Z",
  heartbeatRequired: true,
  heartbeatSequence: 0,
  pid: process.pid,
  actor: os.userInfo().username,
};
const leaseText = `${JSON.stringify(leasePayload)}\n`;
const leaseSha256 = crypto.createHash("sha256").update(leaseText).digest("hex");
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(checkedAt);
  process.env.OPENCLAW_CUSTOM_RUNTIME_HOME = runtimeHome;
  fs.writeFileSync(path.join(runtimeHome, "certification-lease.json"), leaseText, { mode: 0o600 });
  fs.writeFileSync(
    path.join(runtimeHome, "active-runtime.json"),
    `${JSON.stringify({
      sourceSha: leasePayload.activeSha,
      releaseId: leasePayload.activeReleaseId,
    })}\n`,
    { mode: 0o600 },
  );
});
afterAll(() => {
  vi.useRealTimers();
  if (originalRuntimeHome === undefined) {
    delete process.env.OPENCLAW_CUSTOM_RUNTIME_HOME;
  } else {
    process.env.OPENCLAW_CUSTOM_RUNTIME_HOME = originalRuntimeHome;
  }
  fs.rmSync(runtimeHome, { recursive: true, force: true });
});
const modelEvalArtifactTexts = new Map<string, string>();
const soakArtifactBytes = new Map<string, Buffer>();
const judgeClaim = {
  missionId: "mission-goal-run",
  requestBody: "Complete the bounded synthetic Control Director goal.",
  finalText: "The bounded goal completed with exact evidence.",
  evidenceSummary: "artifact:goal-output passed deterministic verification",
  artifactIds: ["artifact:goal-output"],
};

function signedJudgeReceipt(
  overrides: Record<string, unknown> = {},
  privateKey = campaignJudgeKeyPair.privateKey,
) {
  const rawOutput = [
    "VERDICT: APPROVE",
    "SCOPE: bounded synthetic Control Director goal",
    "EVIDENCE: direct exact-runtime evidence passed",
    "RISK: low",
    "REASON: exact evidence supports the claim",
    "CONDITIONS: none",
  ].join("\n");
  const parsed = parseJudgeCompletionVerdict(rawOutput);
  if (parsed.status !== "parsed") {
    throw new Error("Test campaign Judge output must parse.");
  }
  const evidenceContent = `${JSON.stringify({ passed: true, sourceSha })}\n`;
  const evidenceSha256 = crypto.createHash("sha256").update(evidenceContent).digest("hex");
  const evidenceArtifacts = [
    {
      artifactId: judgeClaim.artifactIds[0]!,
      path: "goal-output.json",
      sha256: evidenceSha256,
      content: evidenceContent,
    },
  ];
  const artifactSetSha256 = crypto
    .createHash("sha256")
    .update(
      JSON.stringify(
        evidenceArtifacts.map(({ artifactId, path: artifactPath, sha256 }) => ({
          artifactId,
          path: artifactPath,
          sha256,
        })),
      ),
    )
    .digest("hex");
  const certificationLease = {
    schema: "openclaw.custom-runtime-certification-lease.v2" as const,
    runtimeHome,
    observedLeaseSha256: leaseSha256,
    epochSha256: digestCertificationLeaseEpoch(leasePayload),
    state: leasePayload.state,
    activeSha: sourceSha,
    candidateSha: sourceSha,
    rollbackSha,
    activeReleaseId: certification.activeReleaseId,
    rollbackReleaseId: certification.rollbackReleaseId,
    owner: certification.leaseOwner,
    actor: leasePayload.actor,
    approvalId: certification.approvalId,
    operationId: certification.operationId,
    invocationId: certification.invocationId,
    operationClass: "release-certification" as const,
    createdAt: certification.leaseAcquiredAt,
    expiresAt: leasePayload.expiresAt,
    heartbeatAt: leasePayload.heartbeatAt,
    heartbeatRequired: true as const,
    heartbeatSequence: 0,
    pid: leasePayload.pid,
  };
  const prompt = "Judge the exact M01-M106 campaign.";
  const invocation = {
    runId: "judge-run",
    sessionId: "judge-session",
    judgeAgentId: "independent-judge",
    provider: "judge-runtime",
    model: "control-director-judge:latest",
    startedAt: "2026-07-21T00:03:00.000Z",
    endedAt: "2026-07-21T00:03:30.000Z",
    stopReason: "stop",
  };
  const claimHash = buildControlDirectorJudgeClaimHash(judgeClaim);
  const transcript = {
    schema: "openclaw.control-director-campaign-judge-transcript.v1",
    purpose: "control-director-m01-m106",
    claim: judgeClaim,
    claimHash,
    sourceSha,
    rollbackSha,
    activeReleaseId: certification.activeReleaseId,
    rollbackReleaseId: certification.rollbackReleaseId,
    configurationDigest,
    selectedModel: modelRef,
    selectedModelIdentity,
    judgeModelIdentity,
    artifactSetSha256,
    prompt,
    finalPrompt: prompt,
    rawOutput,
    parsed,
    invocation,
    certificationLease,
    evidenceArtifacts,
  };
  const transcriptContent = `${JSON.stringify(transcript, null, 2)}\n`;
  const campaignIssuance = {
    schema: "openclaw.control-director-campaign-judge-issuance.v1" as const,
    purpose: "control-director-m01-m106" as const,
    sourceSha,
    rollbackSha,
    activeReleaseId: certification.activeReleaseId,
    rollbackReleaseId: certification.rollbackReleaseId,
    configurationDigest,
    selectedModel: modelRef,
    selectedModelIdentity,
    judgeModelIdentity,
    claimHash,
    artifactSetSha256,
    certificationLease,
    transcript: {
      path: "campaign-judge.json",
      sha256: crypto.createHash("sha256").update(transcriptContent).digest("hex"),
      content: transcriptContent,
    },
    invocation: {
      ...invocation,
      requestPromptSha256: crypto.createHash("sha256").update(prompt).digest("hex"),
      finalPromptSha256: crypto.createHash("sha256").update(prompt).digest("hex"),
      rawOutputSha256: crypto.createHash("sha256").update(rawOutput).digest("hex"),
    },
    parsing: {
      parser: "judge-six-line-v1" as const,
      status: "parsed" as const,
      verdict: parsed.verdict,
      parsedVerdictSha256: crypto.createHash("sha256").update(JSON.stringify(parsed)).digest("hex"),
    },
    evidenceArtifacts,
  };
  const unsigned = {
    schemaVersion: 1,
    receiptId: "judge-receipt",
    missionId: judgeClaim.missionId,
    claimHash,
    verdict: "APPROVE",
    scope: "bounded synthetic Control Director goal",
    evidenceSummary: "Direct exact-runtime evidence passed.",
    conditions: "none",
    judgeRunId: "judge-run",
    judgeAgentId: "independent-judge",
    model: "judge-runtime/control-director-judge:latest",
    issuedAt: Date.parse("2026-07-21T00:04:00.000Z"),
    campaignIssuance,
    ...overrides,
  };
  return {
    ...unsigned,
    signature: crypto
      .sign(null, canonicalJudgeReceiptBytes(unsigned), privateKey)
      .toString("base64"),
    publicKeyId: campaignJudgePublicKeyId,
  };
}

function surface(extra: Record<string, unknown> = {}) {
  return {
    passed: true,
    sourceSha,
    checkedAt,
    evidenceRefs: ["artifact:test"],
    ...extra,
  };
}

function macStudioDashboardSurface(width: number, height: number) {
  return surface({
    platform: "mac-studio",
    host: {
      hardwareClass: "Mac Studio",
      osName: "macOS",
      osVersion: "15.6",
      architecture: "arm64",
      hostIdentitySha256: "c".repeat(64),
    },
    browserName: "Chrome",
    browserVersion: "140.0.0",
    viewport: { width, height },
    transcriptVisible: true,
    composerVisible: true,
    keyboardPassed: true,
    accessibilityPassed: true,
    pccOverlapFree: true,
    truthCompletionOverlapFree: true,
  });
}

function latencySample(substantiveResponseMs: number) {
  return {
    ackMs: 100,
    firstActivityMs: 500,
    maximumActivityGapMs: 1_000,
    cancelAckMs: 200,
    substantiveResponseMs,
  };
}

function storeSoakJson(artifactPath: string, value: unknown): { path: string; sha256: string } {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  soakArtifactBytes.set(artifactPath, bytes);
  return {
    path: artifactPath,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}

function storeSoakTranscript(
  artifactPath: string,
  value: string,
): { path: string; sha256: string } {
  const bytes = Buffer.from(value, "utf8");
  soakArtifactBytes.set(artifactPath, bytes);
  return {
    path: artifactPath,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}

function runtimeSoakSurface(offsetsMs = Array.from({ length: 31 }, (_, index) => index * 60_000)) {
  soakArtifactBytes.clear();
  const endedAtMs = Date.parse(checkedAt);
  const startedAtMs = endedAtMs - offsetsMs.at(-1)!;
  const coreCache = runtimeModelCacheEvidence;
  let previousObservationSha256 = "4".repeat(64);
  const samples = offsetsMs.map((offsetMs, index) => {
    const sampleCheckedAt = new Date(startedAtMs + offsetMs).toISOString();
    const prefix = `soak/sample-${String(index).padStart(2, "0")}`;
    const transcripts = Object.fromEntries(
      ["config", "lifecycle", "ollamaLaunchctl", "ollamaList", "ollamaModelfile", "ollamaPs"].map(
        (name) => [
          name,
          storeSoakTranscript(`${prefix}/transcripts/${name}.txt`, `${name}:${index}\n`),
        ],
      ),
    );
    const cacheEvidence = {
      ...coreCache,
      capture: {
        schema: "openclaw.control-director-runtime-identity-capture.v1",
        phase: "restored",
        transitionId: "5".repeat(64),
        capturedAt: sampleCheckedAt,
        sourceSha,
        activeReleaseId: certification.activeReleaseId,
        configDigest: configurationDigest,
        invocationId: certification.invocationId,
        transcripts,
      },
    };
    const cacheBinding = {
      ...storeSoakJson(`${prefix}/cache-evidence.json`, cacheEvidence),
      receipt: cacheEvidence,
    };
    const unsignedObservation = {
      schema: CONTROL_DIRECTOR_CAPABILITY_OBSERVATION_SCHEMA,
      phase: "restored",
      sourceSha,
      releaseId: certification.activeReleaseId,
      selectedModelId: modelRef.replace(/^ollama\//u, ""),
      checkedAt: sampleCheckedAt,
      configurationDigests: [configurationDigest, "6".repeat(64)],
      capabilities: CONTROL_DIRECTOR_CAPABILITY_IDS.map((id) => ({ id })),
      previousObservationSha256,
    };
    const observation = {
      ...unsignedObservation,
      contentSha256: digestControlDirectorCapabilityObservation(unsignedObservation),
    };
    previousObservationSha256 = observation.contentSha256;
    const observationBinding = {
      ...storeSoakJson(`${prefix}/capability-observation.json`, observation),
      receipt: observation,
    };
    const receipt = {
      schema: "openclaw.control-director-stability-sample.v1" as const,
      checkedAt: sampleCheckedAt,
      mode: "active" as const,
      sourceSha,
      activeReleaseId: certification.activeReleaseId,
      selectedModel: modelRef,
      configDigest: configurationDigest,
      gatewayHealthy: true as const,
      capabilitiesPassed: 35 as const,
      routeDriftDetected: false as const,
      capabilityLossDetected: false as const,
      cacheDigest: coreCache.cacheDigest,
      cacheEvidence: cacheBinding,
      capabilityObservation: observationBinding,
      capabilityObservationSha256: observation.contentSha256,
    };
    const bindingWithoutDigest = {
      ...storeSoakJson(`${prefix}/receipt.json`, receipt),
      receipt,
    };
    return {
      ...bindingWithoutDigest,
      sampleDigest: digestControlDirectorStabilitySample(bindingWithoutDigest),
    } as ControlDirectorStabilitySampleBinding;
  });
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
  return surface({
    checkedAt: samples.at(-1)!.receipt.checkedAt,
    evidenceRefs: samples.map((sample) => sample.path),
    startedAt: samples[0]!.receipt.checkedAt,
    endedAt: samples.at(-1)!.receipt.checkedAt,
    durationMs:
      Date.parse(samples.at(-1)!.receipt.checkedAt) - Date.parse(samples[0]!.receipt.checkedAt),
    maximumSamplingGapMs,
    sampleCount: samples.length,
    sampleSetDigest: digestControlDirectorStabilitySamples(samples),
    samples,
  });
}

function resealSoakSample(soak: ReturnType<typeof runtimeSoakSurface>, sampleIndex: number): void {
  const sample = soak.samples[sampleIndex] as ControlDirectorStabilitySampleBinding;
  const receiptBinding = storeSoakJson(sample.path, sample.receipt);
  sample.sha256 = receiptBinding.sha256;
  sample.sampleDigest = digestControlDirectorStabilitySample({
    path: sample.path,
    sha256: sample.sha256,
    receipt: sample.receipt,
  });
  soak.sampleSetDigest = digestControlDirectorStabilitySamples(soak.samples);
}

function modelEvalTrial(
  taskClass: ControlDirectorModelEvalTrial["taskClass"],
  cold: boolean,
  index: number,
): ControlDirectorModelEvalTrial {
  const trialWithoutReceipt = {
    trialId: `${taskClass}-${cold ? "cold" : "warm"}-${index}`,
    modelRef,
    route: "local" as const,
    taskClass,
    cold,
    ackMs: 100,
    firstActivityMs: 500,
    maximumActivityGapMs: 1_000,
    cancelAckMs: 200,
    substantiveResponseMs: cold ? 20_000 : 7_000,
    instructionCoveragePercent: 100,
    recentRecallTop3: true,
    missionContinuity: true,
    completionProofValid: true,
    layoutVisible: true,
    peakCpuPercent: 500,
    peakMemoryGb: 40,
    thermalPressure: "nominal" as const,
    evidenceRefs: [
      "latency:run",
      "recall:run",
      "coverage:run",
      "mission:run",
      "judge:run",
      "layout:run",
      "resource:run",
    ],
  };
  const campaignNonce = buildControlDirectorModelEvalCampaignNonce({
    sourceSha,
    activeReleaseId: certification.activeReleaseId,
    invocationId: certification.invocationId,
  });
  const receiptBase = {
    schema: CONTROL_DIRECTOR_MODEL_EVAL_TRIAL_RECEIPT_SCHEMA,
    sourceSha,
    configurationDigest,
    activeReleaseId: certification.activeReleaseId,
    rollbackReleaseId: certification.rollbackReleaseId,
    leaseOwner: certification.leaseOwner,
    approvalId: certification.approvalId,
    operationId: certification.operationId,
    invocationId: certification.invocationId,
    campaignNonce,
    judgeAgentId: "independent-judge",
    capturedAt: "2026-07-21T00:05:01.000Z",
    startedAt: "2026-07-21T00:00:00.000Z",
    endedAt: "2026-07-21T00:05:00.000Z",
    telemetry: { path: `telemetry/${trialWithoutReceipt.trialId}.json`, sha256: "" },
    artifacts: trialWithoutReceipt.evidenceRefs.map((evidenceRef, artifactIndex) => ({
      evidenceRef,
      path: `artifacts/${trialWithoutReceipt.trialId}-${artifactIndex}.json`,
      sha256: "",
    })),
  };
  for (const artifact of receiptBase.artifacts) {
    const content = `${JSON.stringify({ trial: trialWithoutReceipt })}\n`;
    modelEvalArtifactTexts.set(artifact.path, content);
    artifact.sha256 = crypto.createHash("sha256").update(content).digest("hex");
  }
  const telemetryContent = `${JSON.stringify({
    trial: trialWithoutReceipt,
    kind: "telemetry",
  })}\n`;
  modelEvalArtifactTexts.set(receiptBase.telemetry.path, telemetryContent);
  receiptBase.telemetry.sha256 = crypto.createHash("sha256").update(telemetryContent).digest("hex");
  const measurementReceiptSha256 = digestControlDirectorModelEvalTrialMeasurementReceipt(
    trialWithoutReceipt,
    receiptBase,
  );
  const trialJudgeClaim = buildControlDirectorModelTrialJudgeClaim({
    trial: trialWithoutReceipt,
    campaignNonce,
    receiptSha256: measurementReceiptSha256,
  });
  const rawOutput = [
    "VERDICT: APPROVE",
    "SCOPE: exact model trial",
    `EVIDENCE: ${trialJudgeClaim.evidenceSummary}`,
    "RISK: low",
    "REASON: direct evidence passed",
    "CONDITIONS: none",
  ].join("\n");
  const parsed = parseJudgeCompletionVerdict(rawOutput);
  if (parsed.status !== "parsed") {
    throw new Error("Test Judge output must parse.");
  }
  const measurementFields = [
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
  const measurementSources = measurementFields.map((metric) => ({
    metric,
    evidenceRef: receiptBase.artifacts[0]!.evidenceRef,
    artifactSha256: receiptBase.artifacts[0]!.sha256,
    jsonPointer: `/trial/${metric}`,
    valueSha256: crypto
      .createHash("sha256")
      .update(JSON.stringify(trialWithoutReceipt[metric]))
      .digest("hex"),
  }));
  const evidenceArtifacts = receiptBase.artifacts.map((artifact) => ({
    ...artifact,
    content: modelEvalArtifactTexts.get(artifact.path)!,
  }));
  const certificationLease = {
    schema: "openclaw.custom-runtime-certification-lease.v2" as const,
    runtimeHome,
    observedLeaseSha256: leaseSha256,
    epochSha256: digestCertificationLeaseEpoch(leasePayload),
    state: "acquired",
    activeSha: sourceSha,
    candidateSha: sourceSha,
    rollbackSha: "b".repeat(40),
    activeReleaseId: certification.activeReleaseId,
    rollbackReleaseId: certification.rollbackReleaseId,
    owner: certification.leaseOwner,
    actor: leasePayload.actor,
    approvalId: certification.approvalId,
    operationId: certification.operationId,
    invocationId: certification.invocationId,
    operationClass: "release-certification" as const,
    createdAt: certification.leaseAcquiredAt,
    expiresAt: "2026-07-21T23:29:00.000Z",
    heartbeatAt: leasePayload.heartbeatAt,
    heartbeatRequired: true as const,
    heartbeatSequence: 0,
    pid: leasePayload.pid,
  };
  const invocation = {
    runId: `judge-run-${trialWithoutReceipt.trialId}`,
    sessionId: `judge-session-${trialWithoutReceipt.trialId}`,
    judgeAgentId: "independent-judge",
    provider: "ollama",
    model: "independent-judge:latest",
    startedAt: "2026-07-21T00:05:01.100Z",
    endedAt: "2026-07-21T00:05:01.400Z",
    stopReason: "stop",
  };
  const prompt = `Judge ${trialWithoutReceipt.trialId}`;
  const transcript = {
    schema: "openclaw.control-director-trial-judge-transcript.v1",
    claim: trialJudgeClaim,
    claimHash: buildControlDirectorJudgeClaimHash(trialJudgeClaim),
    prompt,
    finalPrompt: prompt,
    rawOutput,
    parsed,
    invocation,
    trialModelIdentity: selectedModelIdentity,
    judgeModelIdentity,
    measurementReceiptSha256,
    measurementSetSha256: digestControlDirectorModelTrialMeasurementSet(trialWithoutReceipt),
    evidenceSetSha256: digestControlDirectorModelTrialEvidenceSet(receiptBase.artifacts),
    certificationLease,
    measurementSources,
    evidenceArtifacts,
  };
  const transcriptPath = `judge/${trialWithoutReceipt.trialId}.json`;
  const transcriptContent = `${JSON.stringify(transcript, null, 2)}\n`;
  modelEvalArtifactTexts.set(transcriptPath, transcriptContent);
  const trialIssuance = {
    schema: "openclaw.control-director-trial-judge-issuance.v1" as const,
    purpose: "control-director-model-trial" as const,
    campaignNonce,
    trialId: trialWithoutReceipt.trialId,
    trialModelRef: trialWithoutReceipt.modelRef,
    trialModelIdentity: selectedModelIdentity,
    judgeModelIdentity,
    measurementReceiptSha256,
    measurementSetSha256: digestControlDirectorModelTrialMeasurementSet(trialWithoutReceipt),
    evidenceSetSha256: digestControlDirectorModelTrialEvidenceSet(receiptBase.artifacts),
    certificationLease,
    transcript: {
      path: transcriptPath,
      sha256: crypto.createHash("sha256").update(transcriptContent).digest("hex"),
      content: transcriptContent,
    },
    invocation: {
      ...invocation,
      requestPromptSha256: crypto.createHash("sha256").update(prompt).digest("hex"),
      finalPromptSha256: crypto.createHash("sha256").update(prompt).digest("hex"),
      rawOutputSha256: crypto.createHash("sha256").update(rawOutput).digest("hex"),
    },
    parsing: {
      parser: "judge-six-line-v1" as const,
      status: "parsed" as const,
      verdict: "APPROVE" as const,
      parsedVerdictSha256: crypto.createHash("sha256").update(JSON.stringify(parsed)).digest("hex"),
    },
    measurementSources,
    evidenceArtifacts,
  };
  const unsignedJudgeReceipt = {
    schemaVersion: 1 as const,
    receiptId: `judge-receipt-${trialWithoutReceipt.trialId}`,
    missionId: trialJudgeClaim.missionId,
    claimHash: buildControlDirectorJudgeClaimHash(trialJudgeClaim),
    verdict: "APPROVE" as const,
    scope: "exact model trial",
    evidenceSummary: trialJudgeClaim.evidenceSummary,
    conditions: "none",
    judgeRunId: `judge-run-${trialWithoutReceipt.trialId}`,
    judgeAgentId: "independent-judge",
    model: "ollama/independent-judge:latest",
    issuedAt: Date.parse("2026-07-21T00:05:01.500Z"),
    trialIssuance,
  };
  const judgeReceipt = {
    ...unsignedJudgeReceipt,
    publicKeyId: judgePublicKeyId,
    signature: crypto
      .sign(null, canonicalJudgeReceiptBytes(unsignedJudgeReceipt), judgeKeyPair.privateKey)
      .toString("base64"),
  };
  const receiptWithoutDigest = { ...receiptBase, measurementReceiptSha256, judgeReceipt };
  const receiptSha256 = digestControlDirectorModelEvalTrialReceipt(
    trialWithoutReceipt,
    receiptWithoutDigest,
  );
  const signedPayload = buildControlDirectorModelEvalTrialSignedPayload(trialWithoutReceipt, {
    ...receiptWithoutDigest,
    receiptSha256,
  });
  return {
    ...trialWithoutReceipt,
    runtimeReceipt: {
      ...receiptWithoutDigest,
      receiptSha256,
      publicKeyId: judgePublicKeyId,
      signature: crypto
        .sign(null, canonicalJudgeReceiptBytes(signedPayload), judgeKeyPair.privateKey)
        .toString("base64"),
    },
  };
}

function modelEval() {
  const taskClasses = [
    "conversation",
    "recall",
    "planning",
    "delegation",
    "steering",
    "verification",
  ] as const;
  const trials = taskClasses.flatMap((taskClass) =>
    [true, false].flatMap((cold) =>
      Array.from({ length: 4 }, (_, index) => modelEvalTrial(taskClass, cold, index + 1)),
    ),
  );
  return buildControlDirectorModelEvalMatrix({
    trials,
    sourceSha,
    configurationDigest,
    modelRef,
    modelIdentity: selectedModelIdentity,
    certification: {
      ...certification,
      judgeAgentId: "independent-judge",
      judgePublicKeyPem,
      judgePublicKeyId,
    },
    evaluatedAt: checkedAt,
    verifyArtifact: (artifact) => {
      const content = modelEvalArtifactTexts.get(artifact.path);
      return (
        content !== undefined &&
        crypto.createHash("sha256").update(content).digest("hex") === artifact.sha256
      );
    },
    readArtifact: (artifact) => {
      const content = modelEvalArtifactTexts.get(artifact.path);
      return content &&
        crypto.createHash("sha256").update(content).digest("hex") === artifact.sha256
        ? content
        : undefined;
    },
  });
}

function input() {
  const evaluatedModel = modelEval();
  return {
    sourceSha,
    lineageReceipt: {
      ...surface(),
      lineage: { status: "ready", sourceSha },
    },
    modelEval: evaluatedModel,
    verifyModelEvalArtifact: (artifact: { path: string; sha256: string }) => {
      const content = modelEvalArtifactTexts.get(artifact.path);
      return (
        content !== undefined &&
        crypto.createHash("sha256").update(content).digest("hex") === artifact.sha256
      );
    },
    readSoakArtifact: (artifact: { path: string; sha256: string }) =>
      soakArtifactBytes.get(artifact.path),
    verifySoakCapabilityObservation: (observation: Record<string, unknown>) => observation,
    judgePublicKeyPem,
    expectedJudgePublicKeyId: judgePublicKeyId,
    campaignJudgePublicKeyPem,
    expectedCampaignJudgePublicKeyId: campaignJudgePublicKeyId,
    expectedJudgeAgentId: "independent-judge",
    certification,
    surfaces: {
      macStudioDashboard: macStudioDashboardSurface(1440, 900),
      localModelRouting: surface({
        route: "local",
        modelRef,
        qualityScore: 95,
      }),
      localModelLatency: surface({
        cold: latencySample(20_000),
        warm: latencySample(7_000),
      }),
      memory: surface({
        recentRecallTopK: 3,
        recallPassed: true,
        provenanceVerified: true,
      }),
      delegation: surface({
        controlDirectorRunId: "run-director",
        programManagerRunId: "run-program-manager",
        workerRunId: "run-worker",
        taskRootVerified: true,
        handoffVerified: true,
      }),
      judge: surface({
        claim: judgeClaim,
        receipt: signedJudgeReceipt(),
      }),
      sig: surface({
        auditEventId: "sig-event",
        ingested: true,
        routed: true,
        backgroundEnabled: true,
      }),
      pcc: surface({
        projectId: "pcc-project",
        stateConsistent: true,
        evidenceProjectionVerified: true,
      }),
      queue: surface({
        queuedTurnId: "queued-turn",
        accepted: true,
        processed: true,
        orderPreserved: true,
      }),
      steer: surface({
        steerTurnId: "steer-turn",
        accepted: true,
        applied: true,
        activeRunPreserved: true,
      }),
      cancel: surface({
        cancelId: "cancel-run",
        accepted: true,
        workStopped: true,
        staleRunningCleared: true,
      }),
      pursueGoal: surface({
        goalId: "goal-run",
        missionId: judgeClaim.missionId,
        artifactIds: judgeClaim.artifactIds,
        startedAt: "2026-07-21T00:00:00.000Z",
        leaseObserved: true,
        progressObserved: true,
        resumeVerified: true,
        stopVerified: true,
      }),
      restartRecovery: surface({
        restartId: "restart-run",
        serviceHealthy: true,
        goalRecovered: true,
        pendingTurnsRecovered: true,
      }),
      soak: runtimeSoakSurface(),
      rollback: surface({
        rollbackSha: "b".repeat(40),
        restored: true,
        serviceHealthy: true,
      }),
      liveDiagnostic: surface({
        sessionId: "live-session",
        ackObserved: true,
        activityObserved: true,
        finalResponseReceived: true,
      }),
    },
    generatedAt: checkedAt,
  };
}

describe("Control Director runtime proof assembler", () => {
  it("exports a reusable replay verifier for digest-bound runtime soak samples", () => {
    const soak = runtimeSoakSurface();
    expect(
      verifyControlDirectorRuntimeSoak({
        evidence: soak,
        expected: {
          sourceSha,
          activeReleaseId: certification.activeReleaseId,
          configurationDigest,
          selectedModel: modelRef,
          invocationId: certification.invocationId,
          notBefore: certification.leaseAcquiredAt,
          notAfter: checkedAt,
        },
        readArtifact: (artifact) => soakArtifactBytes.get(artifact.path),
        verifyCapabilityObservation: (observation) => observation,
      }),
    ).toMatchObject({
      durationMs: 1_800_000,
      maximumSamplingGapMs: 60_000,
      sampleCount: 31,
      activeReleaseId: certification.activeReleaseId,
      selectedModel: modelRef,
      configurationDigest,
      routeDriftDetected: false,
      capabilityLossDetected: false,
    });
  });

  it("assembles exact-SHA evidence only after every runtime surface passes", () => {
    expect(buildControlDirectorRuntimeProof(input())).toMatchObject({
      schemaVersion: 4,
      sourceSha,
      generatedAt: checkedAt,
      sigBackgroundEnabled: true,
      lineage: { status: "ready", sourceSha },
      macStudioDashboard: {
        passed: true,
        platform: "mac-studio",
        host: { hardwareClass: "Mac Studio", architecture: "arm64" },
      },
      soak: {
        durationMs: 1_800_000,
        maximumSamplingGapMs: 60_000,
        sampleCount: 31,
      },
    });
  });

  it("rejects missing, sparse, tampered, wrong-identity, capability-loss, route-drift, and cache-drift samples", () => {
    const missing = input();
    missing.surfaces.soak.samples = [];
    expect(() => buildControlDirectorRuntimeProof(missing)).toThrow(
      "replayable stability sample bindings",
    );

    const missingArtifact = input();
    const missingArtifactSoak = missingArtifact.surfaces.soak;
    soakArtifactBytes.delete(missingArtifactSoak.samples[0]!.path);
    expect(() => buildControlDirectorRuntimeProof(missingArtifact)).toThrow(
      "digest-bound artifact verification",
    );

    const sparse = input();
    sparse.surfaces.soak = runtimeSoakSurface([
      ...Array.from({ length: 15 }, (_, index) => index * 60_000),
      ...Array.from({ length: 16 }, (_, index) => (index + 16) * 60_000),
    ]);
    expect(() => buildControlDirectorRuntimeProof(sparse)).toThrow("gaps no larger than 60000ms");

    const tampered = input();
    Object.assign(tampered.surfaces.soak.samples[0]!.receipt, { gatewayHealthy: false });
    expect(() => buildControlDirectorRuntimeProof(tampered)).toThrow(
      "artifact does not bind its embedded receipt",
    );

    const wrongIdentity = input();
    Object.assign(wrongIdentity.surfaces.soak.samples[0]!.receipt, {
      activeReleaseId: "wrong-release",
    });
    resealSoakSample(wrongIdentity.surfaces.soak, 0);
    expect(() => buildControlDirectorRuntimeProof(wrongIdentity)).toThrow(
      "not a healthy exact-runtime active sample",
    );

    const capabilityLoss = input();
    Object.assign(capabilityLoss.surfaces.soak.samples[0]!.receipt, {
      capabilityLossDetected: true,
    });
    resealSoakSample(capabilityLoss.surfaces.soak, 0);
    expect(() => buildControlDirectorRuntimeProof(capabilityLoss)).toThrow(
      "not a healthy exact-runtime active sample",
    );

    const routeDrift = input();
    Object.assign(routeDrift.surfaces.soak.samples[0]!.receipt, {
      routeDriftDetected: true,
    });
    resealSoakSample(routeDrift.surfaces.soak, 0);
    expect(() => buildControlDirectorRuntimeProof(routeDrift)).toThrow(
      "not a healthy exact-runtime active sample",
    );

    const cacheDrift = input();
    Object.assign(cacheDrift.surfaces.soak.samples[0]!.receipt, {
      cacheDigest: "9".repeat(64),
    });
    resealSoakSample(cacheDrift.surfaces.soak, 0);
    expect(() => buildControlDirectorRuntimeProof(cacheDrift)).toThrow("cache identity drifted");
  });

  it("rejects mismatched, incomplete, or too-short runtime proof", () => {
    const mismatched = input();
    mismatched.surfaces.macStudioDashboard.sourceSha = "b".repeat(40);
    expect(() => buildControlDirectorRuntimeProof(mismatched)).toThrow(
      "macStudioDashboard sourceSha",
    );

    const collapsedJudgeTrust = input();
    collapsedJudgeTrust.expectedCampaignJudgePublicKeyId =
      collapsedJudgeTrust.expectedJudgePublicKeyId;
    expect(() => buildControlDirectorRuntimeProof(collapsedJudgeTrust)).toThrow(
      "distinct Judge trust identities",
    );

    const incompleteDashboard = input();
    incompleteDashboard.surfaces.macStudioDashboard.passed = false;
    expect(() => buildControlDirectorRuntimeProof(incompleteDashboard)).toThrow(
      "macStudioDashboard evidence has not passed",
    );

    const wrongHost = input();
    wrongHost.surfaces.macStudioDashboard.host.hardwareClass = "MacBook Pro";
    expect(() => buildControlDirectorRuntimeProof(wrongHost)).toThrow(
      "arm64 Mac Studio running macOS",
    );

    const invalidHostIdentity = input();
    Object.assign(invalidHostIdentity.surfaces.macStudioDashboard.host, {
      hostIdentitySha256: {},
    });
    expect(() => buildControlDirectorRuntimeProof(invalidHostIdentity)).toThrow(
      "hostIdentitySha256 requires a non-empty string",
    );

    const selfAssertedDuration = input();
    selfAssertedDuration.surfaces.soak.durationMs = 99_999_999;
    expect(() => buildControlDirectorRuntimeProof(selfAssertedDuration)).toThrow(
      "summary does not replay",
    );

    const partialEval = input();
    partialEval.modelEval.coveragePassed = false;
    expect(() => buildControlDirectorRuntimeProof(partialEval)).toThrow("full coverage");

    const tamperedTrial = input();
    tamperedTrial.modelEval.results[0]!.trial.ackMs += 1;
    expect(() => buildControlDirectorRuntimeProof(tamperedTrial)).toThrow(
      "trial receipts are not independently digest-bound",
    );

    const unverifiedArtifact = input();
    unverifiedArtifact.verifyModelEvalArtifact = () => false;
    expect(() => buildControlDirectorRuntimeProof(unverifiedArtifact)).toThrow(
      "trial receipts are not independently digest-bound",
    );

    const tamperedJudge = input();
    tamperedJudge.surfaces.judge.receipt.evidenceSummary = "tampered after signing";
    expect(() => buildControlDirectorRuntimeProof(tamperedJudge)).toThrow(
      "signature does not match the trusted public key",
    );

    const genericDirectSignature = input();
    const {
      campaignIssuance: _campaignIssuance,
      signature: _signature,
      publicKeyId: _publicKeyId,
      ...genericUnsigned
    } = genericDirectSignature.surfaces.judge.receipt;
    genericDirectSignature.surfaces.judge.receipt = {
      ...genericUnsigned,
      signature: crypto
        .sign(null, canonicalJudgeReceiptBytes(genericUnsigned), campaignJudgeKeyPair.privateKey)
        .toString("base64"),
      publicKeyId: campaignJudgePublicKeyId,
    };
    expect(() => buildControlDirectorRuntimeProof(genericDirectSignature)).toThrow(
      "service-issued M01-M106 campaign provenance",
    );

    const genericKeyForgery = input();
    const {
      signature: _genericSignature,
      publicKeyId: _genericPublicKeyId,
      ...forgedCampaignUnsigned
    } = genericKeyForgery.surfaces.judge.receipt;
    genericKeyForgery.surfaces.judge.receipt = {
      ...forgedCampaignUnsigned,
      signature: crypto
        .sign(null, canonicalJudgeReceiptBytes(forgedCampaignUnsigned), judgeKeyPair.privateKey)
        .toString("base64"),
      publicKeyId: judgePublicKeyId,
    };
    expect(() => buildControlDirectorRuntimeProof(genericKeyForgery)).toThrow(
      "signature does not match the trusted public key",
    );

    const wrongClaim = input();
    wrongClaim.surfaces.judge.claim.finalText = "Different completion claim.";
    expect(() => buildControlDirectorRuntimeProof(wrongClaim)).toThrow(
      "does not bind the exact completion claim",
    );

    const wrongMission = input();
    wrongMission.surfaces.pursueGoal.missionId = "another-mission";
    expect(() => buildControlDirectorRuntimeProof(wrongMission)).toThrow(
      "mission does not match the Pursue Goal mission",
    );

    const wrongKey = crypto.generateKeyPairSync("ed25519");
    const wrongTrustedKey = input();
    wrongTrustedKey.judgePublicKeyPem = wrongKey.publicKey.export({
      type: "spki",
      format: "pem",
    });
    expect(() => buildControlDirectorRuntimeProof(wrongTrustedKey)).toThrow(
      "model evaluation trial receipts are not independently digest-bound exact-runtime evidence",
    );

    const rejected = input();
    rejected.surfaces.judge.receipt = signedJudgeReceipt({ verdict: "REJECT" });
    expect(() => buildControlDirectorRuntimeProof(rejected)).toThrow(
      "not an approving signed v1 decision",
    );

    const staleJudge = input();
    staleJudge.surfaces.judge.receipt = signedJudgeReceipt({
      issuedAt: Date.parse("2026-07-17T23:59:59.000Z"),
    });
    expect(() => buildControlDirectorRuntimeProof(staleJudge)).toThrow(
      "signature does not match the trusted public key",
    );

    const invalidTimestamp = input();
    invalidTimestamp.generatedAt = "not-a-timestamp";
    expect(() => buildControlDirectorRuntimeProof(invalidTimestamp)).toThrow(
      "generatedAt must be a valid timestamp",
    );

    const disabledSigBackground = input();
    disabledSigBackground.surfaces.sig.backgroundEnabled = false;
    expect(() => buildControlDirectorRuntimeProof(disabledSigBackground)).toThrow(
      "sig.backgroundEnabled must be true",
    );

    const futureSurface = input();
    futureSurface.surfaces.macStudioDashboard.checkedAt = "2026-07-21T00:05:03.000Z";
    expect(() => buildControlDirectorRuntimeProof(futureSurface)).toThrow(
      "macStudioDashboard evidence cannot postdate generatedAt",
    );
  });
});

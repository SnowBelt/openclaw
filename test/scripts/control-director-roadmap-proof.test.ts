import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CONTROL_DIRECTOR_CAPABILITY_IDS,
  CONTROL_DIRECTOR_CAPABILITY_OBSERVATION_SCHEMA,
  CONTROL_DIRECTOR_CAPABILITY_PROBE_REQUIREMENTS,
  digestControlDirectorCapabilityObservation,
} from "../../scripts/control-director-capability-observer.mjs";
import {
  buildCertifiedControlDirectorRoadmapProjection,
  buildControlDirectorFinalLedgerAuthority,
  controlDirectorRoadmapPathMatchesCanonical,
  controlDirectorSourceProofMatchesRoot,
  summarizeControlDirectorProgress,
  validateControlDirectorRoadmap as validateControlDirectorRoadmapImplementation,
  verifyControlDirectorFinalLedgerAuthority,
} from "../../scripts/control-director-roadmap-proof.mjs";
import { buildControlDirectorJudgeClaimHash } from "../../src/agents/control-director-contract.ts";
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
} from "../../src/agents/control-director-model-eval.ts";
import {
  buildControlDirectorCacheIdentityEvidence,
  buildControlDirectorStabilityProof,
  CONTROL_DIRECTOR_STABILITY_SAMPLE_SCHEMA,
  digestControlDirectorStatisticalTrials,
  digestControlDirectorStabilitySample,
  digestControlDirectorStabilitySamples,
  digestModelGovernanceIdentity,
  type ControlDirectorStabilitySample,
  type ControlDirectorStabilitySampleBinding,
} from "../../src/agents/control-director-model-governance-proof.ts";
import { parseJudgeCompletionVerdict } from "../../src/agents/judge-gate.ts";
import {
  canonicalJudgeReceiptBytes,
  digestCertificationLeaseEpoch,
} from "../../src/agents/judge-receipt-signer.ts";

const sourceSha = "a".repeat(40);
const selectedModel = "ollama/openclaw-control-qwen25-32b:latest";
const expectedConfigDigest = "f".repeat(64);
const expectedRollbackSha = "b".repeat(40);
const expectedActiveReleaseId = "release-active";
const expectedRollbackReleaseId = "release-rollback";
const expectedLeaseOwner = "codex:test";
const expectedApprovalId = "release-governor:test";
const expectedOperationId = "certification:test";
const expectedInvocationId = "certification-test";
const modelDigest = "1".repeat(64);
const manifestDigest = "2".repeat(64);
const cacheEvidence = buildControlDirectorCacheIdentityEvidence({
  selectedModel,
  modelId: selectedModel.replace(/^ollama\//u, ""),
  modelDigest,
  manifestDigest,
  baseBlobDigests: ["3".repeat(64)],
  kvCacheType: "q8_0",
  residency: {
    modelId: selectedModel.replace(/^ollama\//u, ""),
    digest: manifestDigest,
    sizeBytes: 32_000_000_000,
    vramBytes: 24_000_000_000,
  },
});
const cacheDigest = cacheEvidence.cacheDigest;
const selectedModelIdentity = { modelDigest, cacheDigest };
const judgeModelIdentity = {
  modelDigest: "8".repeat(64),
  cacheDigest: "9".repeat(64),
};
const sourceCheckedAt = "2026-07-19T12:05:00.000Z";
const runtimeCheckedAt = "2026-07-21T02:05:02.000Z";
const readinessCheckedAt = "2026-07-21T02:10:00.000Z";
const modelGovernanceCheckedAt = "2026-07-21T02:15:00.000Z";
const stabilityCheckedAt = "2026-07-22T03:00:00.000Z";
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
const modelEvalArtifactTexts = new Map<string, string>();
const runtimeSoakArtifactBytes = new Map<string, Buffer>();
const originalRuntimeHome = process.env.OPENCLAW_CUSTOM_RUNTIME_HOME;
const certificationRuntimeHome = fs.mkdtempSync(
  path.join(os.tmpdir(), "openclaw-roadmap-proof-lease-"),
);
const certificationLeasePayload = {
  schema: "openclaw.custom-runtime-certification-lease.v2",
  state: "acquired",
  activeSha: sourceSha,
  candidateSha: sourceSha,
  rollbackSha: expectedRollbackSha,
  activeReleaseId: expectedActiveReleaseId,
  rollbackReleaseId: expectedRollbackReleaseId,
  owner: expectedLeaseOwner,
  approvalId: expectedApprovalId,
  operationId: expectedOperationId,
  invocationId: expectedInvocationId,
  operationClass: "release-certification",
  createdAt: "2026-07-21T01:29:00.000Z",
  expiresAt: "2026-07-22T01:29:00.000Z",
  heartbeatAt: "2026-07-21T02:04:30.000Z",
  heartbeatRequired: true,
  heartbeatSequence: 0,
  pid: process.pid,
  actor: os.userInfo().username,
};
const certificationLeaseText = `${JSON.stringify(certificationLeasePayload)}\n`;
const certificationLeaseSha256 = crypto
  .createHash("sha256")
  .update(certificationLeaseText)
  .digest("hex");
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(runtimeCheckedAt);
  process.env.OPENCLAW_CUSTOM_RUNTIME_HOME = certificationRuntimeHome;
  fs.writeFileSync(
    path.join(certificationRuntimeHome, "certification-lease.json"),
    certificationLeaseText,
    { mode: 0o600 },
  );
  fs.writeFileSync(
    path.join(certificationRuntimeHome, "active-runtime.json"),
    `${JSON.stringify({
      sourceSha: certificationLeasePayload.activeSha,
      releaseId: certificationLeasePayload.activeReleaseId,
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
  fs.rmSync(certificationRuntimeHome, { recursive: true, force: true });
});
const judgeClaim = {
  missionId: "mission-goal-run",
  requestBody: "Complete the bounded synthetic Control Director goal.",
  finalText: "The bounded goal completed with exact evidence.",
  evidenceSummary: "artifact:goal-output passed deterministic verification",
  artifactIds: ["artifact:goal-output"],
};

function signedJudgeReceipt(overrides: Record<string, unknown> = {}) {
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
    runtimeHome: certificationRuntimeHome,
    observedLeaseSha256: certificationLeaseSha256,
    epochSha256: digestCertificationLeaseEpoch(certificationLeasePayload),
    state: certificationLeasePayload.state,
    activeSha: sourceSha,
    candidateSha: sourceSha,
    rollbackSha: expectedRollbackSha,
    activeReleaseId: expectedActiveReleaseId,
    rollbackReleaseId: expectedRollbackReleaseId,
    owner: expectedLeaseOwner,
    actor: certificationLeasePayload.actor,
    approvalId: expectedApprovalId,
    operationId: expectedOperationId,
    invocationId: expectedInvocationId,
    operationClass: "release-certification" as const,
    createdAt: certificationLeasePayload.createdAt,
    expiresAt: certificationLeasePayload.expiresAt,
    heartbeatAt: certificationLeasePayload.heartbeatAt,
    heartbeatRequired: true as const,
    heartbeatSequence: 0,
    pid: certificationLeasePayload.pid,
  };
  const prompt = "Judge the exact M01-M106 campaign.";
  const invocation = {
    runId: "judge-run",
    sessionId: "judge-session",
    judgeAgentId: "independent-judge",
    provider: "judge-runtime",
    model: "control-director-judge:latest",
    startedAt: "2026-07-21T02:03:00.000Z",
    endedAt: "2026-07-21T02:03:30.000Z",
    stopReason: "stop",
  };
  const claimHash = buildControlDirectorJudgeClaimHash(judgeClaim);
  const transcript = {
    schema: "openclaw.control-director-campaign-judge-transcript.v1",
    purpose: "control-director-m01-m106",
    claim: judgeClaim,
    claimHash,
    sourceSha,
    rollbackSha: expectedRollbackSha,
    activeReleaseId: expectedActiveReleaseId,
    rollbackReleaseId: expectedRollbackReleaseId,
    configurationDigest: expectedConfigDigest,
    selectedModel,
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
    rollbackSha: expectedRollbackSha,
    activeReleaseId: expectedActiveReleaseId,
    rollbackReleaseId: expectedRollbackReleaseId,
    configurationDigest: expectedConfigDigest,
    selectedModel,
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
    issuedAt: Date.parse("2026-07-21T02:04:00.000Z"),
    campaignIssuance,
    ...overrides,
  };
  return {
    ...unsigned,
    signature: crypto
      .sign(null, canonicalJudgeReceiptBytes(unsigned), campaignJudgeKeyPair.privateKey)
      .toString("base64"),
    publicKeyId: campaignJudgePublicKeyId,
  };
}

function validateControlDirectorRoadmap(params: Record<string, unknown>) {
  return validateControlDirectorRoadmapImplementation({
    ...params,
    expectedActiveReleaseId: params.expectedActiveReleaseId ?? expectedActiveReleaseId,
    expectedRollbackReleaseId: params.expectedRollbackReleaseId ?? expectedRollbackReleaseId,
    expectedLeaseOwner: params.expectedLeaseOwner ?? expectedLeaseOwner,
    expectedApprovalId: params.expectedApprovalId ?? expectedApprovalId,
    expectedOperationId: params.expectedOperationId ?? expectedOperationId,
    expectedInvocationId: params.expectedInvocationId ?? expectedInvocationId,
    judgePublicKeyPem: params.judgePublicKeyPem ?? judgePublicKeyPem,
    expectedJudgePublicKeyId: params.expectedJudgePublicKeyId ?? judgePublicKeyId,
    campaignJudgePublicKeyPem: params.campaignJudgePublicKeyPem ?? campaignJudgePublicKeyPem,
    expectedCampaignJudgePublicKeyId:
      params.expectedCampaignJudgePublicKeyId ?? campaignJudgePublicKeyId,
    verifyStabilityArtifact: params.verifyStabilityArtifact ?? (() => true),
    verifyStabilityCapabilityObservation:
      params.verifyStabilityCapabilityObservation ??
      ((observation: Record<string, unknown>) => observation),
    verifyRuntimeIdentityEvidence: params.verifyRuntimeIdentityEvidence ?? (() => true),
    verifyCapabilityArtifact: params.verifyCapabilityArtifact ?? (() => true),
    readRuntimeSoakArtifact:
      params.readRuntimeSoakArtifact ??
      ((artifact: { path: string }) => runtimeSoakArtifactBytes.get(artifact.path)),
    verifyRuntimeSoakCapabilityObservation:
      params.verifyRuntimeSoakCapabilityObservation ??
      ((observation: Record<string, unknown>) => observation),
    verifyModelEvalArtifact: (artifact: { path: string; sha256: string }) => {
      const content = modelEvalArtifactTexts.get(artifact.path);
      return (
        content !== undefined &&
        crypto.createHash("sha256").update(content).digest("hex") === artifact.sha256
      );
    },
  });
}

function roadmap(): Record<string, unknown> {
  const value = JSON.parse(
    fs.readFileSync(path.resolve("work/control-director/reliability-v1/roadmap.json"), "utf8"),
  ) as Record<string, unknown>;
  value.evidenceBinding = {
    sourceProof: ".artifacts/control-director/source-gates-<source-sha>.json",
    updateSurvival: ".artifacts/control-director/update-survival-<source-sha>.json",
    runtimeProof: ".artifacts/control-director/runtime-<source-sha>/runtime-proof.json",
    localValidationProof: ".artifacts/control-director/mac-studio-validation-<source-sha>.json",
    readiness: ".artifacts/control-director/runtime-<source-sha>/readiness.json",
    modelGovernanceProof: ".artifacts/control-director/model-governance-<source-sha>.json",
    stabilityProof: ".artifacts/control-director/stability-<source-sha>.json",
    capabilityProof: ".artifacts/control-director/capabilities-<source-sha>.json",
    finalReceipt: ".artifacts/control-director/final-ledger-<source-sha>.json",
  };
  for (const milestone of value.milestones as Array<Record<string, unknown>>) {
    milestone.status = "passed";
    milestone.implementationStatus = "implemented";
    milestone.certificationStatus = "passed";
    milestone.evidence = ["binding:sourceProof", "test:synthetic"];
  }
  const milestone61 = (value.milestones as Array<Record<string, unknown>>).find(
    (milestone) => milestone.id === "M61",
  );
  milestone61!.evidence = [
    "binding:sourceProof",
    "binding:updateSurvival",
    "binding:runtimeProof",
    "binding:readiness",
    "test:update-survival",
    "runtime:update-survival",
  ];
  const milestone66 = (value.milestones as Array<Record<string, unknown>>).find(
    (milestone) => milestone.id === "M66",
  );
  milestone66!.evidence = ["binding:runtimeProof", "runtime:deployment-consistency"];
  const milestone67 = (value.milestones as Array<Record<string, unknown>>).find(
    (milestone) => milestone.id === "M67",
  );
  milestone67!.evidence = ["binding:runtimeProof", "runtime:diagnostic-truth"];
  const milestone68 = (value.milestones as Array<Record<string, unknown>>).find(
    (milestone) => milestone.id === "M68",
  );
  milestone68!.evidence = [
    "binding:sourceProof",
    "binding:updateSurvival",
    "binding:runtimeProof",
    "binding:localValidationProof",
    "binding:readiness",
    "runtime:end-to-end-orchestration",
  ];
  const milestone85 = (value.milestones as Array<Record<string, unknown>>).find(
    (milestone) => milestone.id === "M85",
  );
  milestone85!.evidence = [
    "binding:runtimeProof",
    "binding:readiness",
    "runtime:managed-certification",
  ];
  const milestone86 = (value.milestones as Array<Record<string, unknown>>).find(
    (milestone) => milestone.id === "M86",
  );
  milestone86!.evidence = [
    "binding:sourceProof",
    "binding:updateSurvival",
    "binding:runtimeProof",
    "binding:localValidationProof",
    "binding:readiness",
    "runtime:final-ledger",
  ];
  for (const milestone of (value.milestones as Array<Record<string, unknown>>).filter(
    (entry) => typeof entry.id === "string" && /^M(?:8[7-9]|9[0-9]|10[0-2])$/u.test(entry.id),
  )) {
    milestone.evidence = [
      "binding:modelGovernanceProof",
      "source:model-governance-contract",
      "test:model-governance",
    ];
  }
  for (const milestone of (value.milestones as Array<Record<string, unknown>>).filter(
    (entry) => typeof entry.id === "string" && /^M10[3-5]$/u.test(entry.id),
  )) {
    milestone.evidence = ["binding:stabilityProof", "source:stability-contract", "test:stability"];
  }
  const milestone106 = (value.milestones as Array<Record<string, unknown>>).find(
    (milestone) => milestone.id === "M106",
  );
  milestone106!.evidence = [
    "binding:sourceProof",
    "binding:updateSurvival",
    "binding:runtimeProof",
    "binding:localValidationProof",
    "binding:readiness",
    "binding:modelGovernanceProof",
    "binding:stabilityProof",
    "runtime:durable-final-ledger",
  ];
  return value;
}

function sourceProof() {
  return {
    schemaVersion: 2,
    sourceSha,
    expectedSha: sourceSha,
    sourceRoot: "/tmp/repo",
    sourceClean: true,
    identityVerified: true,
    passed: true,
    generatedAt: sourceCheckedAt,
    completedAt: sourceCheckedAt,
    commands: [
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
    ].map((id) => ({ id, status: "passed" })),
  };
}

function updateSurvival() {
  return {
    schema: "openclaw.custom-runtime-update-survival.v1",
    mode: "source-contract",
    sourceSha,
    sourceClean: true,
    contractVersion: 2,
    sourceStrategy: "merge_from_active_sha",
    dashboardChangePolicy: "register_verify_and_block",
    approvalPolicy: "explicit_exact_candidate",
    proofCommand: "pnpm custom-runtime:update-survival",
    manifestVersion: 5,
    manifestSha256: "d".repeat(64),
    verificationCommands: [
      "pnpm check:custom-runtime-capabilities",
      "pnpm check:pcc-capabilities",
      "pnpm control-director:verify -- --expected-sha <candidate-sha>",
      "pnpm check",
      "pnpm ui:build",
      "pnpm build",
      "pnpm ui:smoke:dashboard --artifact-profile release --artifact-root .artifacts/custom-runtime-update",
    ],
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
    checkedAt: sourceCheckedAt,
    evidenceRefs: ["config/custom-runtime-capabilities.json"],
    passed: true,
  };
}

function storeRuntimeSoakJson(artifactPath: string, value: unknown) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  runtimeSoakArtifactBytes.set(artifactPath, bytes);
  return {
    path: artifactPath,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}

function storeRuntimeSoakText(artifactPath: string, value: string) {
  const bytes = Buffer.from(value, "utf8");
  runtimeSoakArtifactBytes.set(artifactPath, bytes);
  return {
    path: artifactPath,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}

function runtimeSoakSurface() {
  runtimeSoakArtifactBytes.clear();
  const endedAtMs = Date.parse(runtimeCheckedAt);
  const startedAtMs = endedAtMs - 30 * 60_000;
  let previousObservationSha256: string | undefined;
  const samples = Array.from({ length: 31 }, (_, index) => {
    const checkedAt = new Date(startedAtMs + index * 60_000).toISOString();
    const prefix = `.artifacts/control-director/runtime-soak/${index}`;
    const transcripts = Object.fromEntries(
      ["config", "lifecycle", "ollamaLaunchctl", "ollamaList", "ollamaModelfile", "ollamaPs"].map(
        (name) => [
          name,
          storeRuntimeSoakText(`${prefix}/transcripts/${name}.txt`, `${name}:${index}\n`),
        ],
      ),
    );
    const sampleCacheEvidence = {
      ...cacheEvidence,
      capture: {
        schema: "openclaw.control-director-runtime-identity-capture.v1",
        phase: "restored",
        transitionId: "5".repeat(64),
        capturedAt: checkedAt,
        sourceSha,
        activeReleaseId: expectedActiveReleaseId,
        configDigest: expectedConfigDigest,
        invocationId: expectedInvocationId,
        transcripts,
      },
    };
    const cacheBinding = {
      ...storeRuntimeSoakJson(`${prefix}/cache-evidence.json`, sampleCacheEvidence),
      receipt: sampleCacheEvidence,
    };
    const unsignedObservation = {
      schema: CONTROL_DIRECTOR_CAPABILITY_OBSERVATION_SCHEMA,
      phase: "restored",
      sourceSha,
      releaseId: expectedActiveReleaseId,
      selectedModelId: selectedModel.replace(/^ollama\//u, ""),
      checkedAt,
      configurationDigests: [expectedConfigDigest, "e".repeat(64)],
      capabilities: CONTROL_DIRECTOR_CAPABILITY_IDS.map((id) => ({ id })),
      previousObservationSha256,
    };
    const observation = {
      ...unsignedObservation,
      contentSha256: digestControlDirectorCapabilityObservation(unsignedObservation),
    };
    previousObservationSha256 = observation.contentSha256;
    const observationBinding = {
      ...storeRuntimeSoakJson(`${prefix}/capability-observation.json`, observation),
      receipt: observation,
    };
    const receipt: ControlDirectorStabilitySample = {
      schema: CONTROL_DIRECTOR_STABILITY_SAMPLE_SCHEMA,
      checkedAt,
      mode: "active",
      sourceSha,
      activeReleaseId: expectedActiveReleaseId,
      selectedModel,
      configDigest: expectedConfigDigest,
      gatewayHealthy: true,
      capabilitiesPassed: CONTROL_DIRECTOR_CAPABILITY_IDS.length,
      routeDriftDetected: false,
      capabilityLossDetected: false,
      cacheDigest,
      cacheEvidence: cacheBinding,
      capabilityObservation: observationBinding,
      capabilityObservationSha256: observation.contentSha256,
    };
    const bindingWithoutDigest = {
      ...storeRuntimeSoakJson(`${prefix}/sample.json`, receipt),
      receipt,
    };
    return {
      ...bindingWithoutDigest,
      sampleDigest: digestControlDirectorStabilitySample(bindingWithoutDigest),
    } as ControlDirectorStabilitySampleBinding;
  });
  return {
    sourceSha,
    passed: true,
    checkedAt: runtimeCheckedAt,
    evidenceRefs: samples.map((sample) => sample.path),
    startedAt: samples[0]!.receipt.checkedAt,
    endedAt: samples.at(-1)!.receipt.checkedAt,
    durationMs: 30 * 60_000,
    maximumSamplingGapMs: 60_000,
    sampleCount: samples.length,
    sampleSetDigest: digestControlDirectorStabilitySamples(samples),
    activeReleaseId: expectedActiveReleaseId,
    selectedModel,
    configurationDigest: expectedConfigDigest,
    cacheDigest,
    modelDigest,
    routeDriftDetected: false,
    capabilityLossDetected: false,
    samples,
  };
}

function runtimeProof() {
  const surface = {
    sourceSha,
    passed: true,
    checkedAt: runtimeCheckedAt,
    evidenceRefs: ["artifact:synthetic"],
  };
  const macStudioDashboardSurface = (width: number, height: number) => ({
    ...surface,
    platform: "mac-studio",
    host: {
      hardwareClass: "Mac Studio",
      osName: "macOS",
      osVersion: "15.6",
      architecture: "arm64",
      hostIdentitySha256: "e".repeat(64),
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
  const latencySample = (substantiveResponseMs: number) => ({
    ackMs: 100,
    firstActivityMs: 500,
    maximumActivityGapMs: 1_000,
    cancelAckMs: 200,
    substantiveResponseMs,
  });
  const trials = [
    "conversation",
    "recall",
    "planning",
    "delegation",
    "steering",
    "verification",
  ].flatMap((taskClass) =>
    [true, false].flatMap((cold) =>
      Array.from({ length: 4 }, (_, index) => {
        const trialWithoutReceipt = {
          trialId: `${taskClass}-${cold ? "cold" : "warm"}-${index + 1}`,
          taskClass: taskClass as ControlDirectorModelEvalTrial["taskClass"],
          cold,
          modelRef: selectedModel,
          route: "local" as const,
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
            "latency:trial",
            "recall:trial",
            "coverage:trial",
            "mission:trial",
            "judge:trial",
            "layout:trial",
            "resource:trial",
          ],
        };
        const campaignNonce = buildControlDirectorModelEvalCampaignNonce({
          sourceSha,
          activeReleaseId: expectedActiveReleaseId,
          invocationId: expectedInvocationId,
        });
        const receiptBase = {
          schema: CONTROL_DIRECTOR_MODEL_EVAL_TRIAL_RECEIPT_SCHEMA,
          sourceSha,
          configurationDigest: expectedConfigDigest,
          activeReleaseId: expectedActiveReleaseId,
          rollbackReleaseId: expectedRollbackReleaseId,
          leaseOwner: expectedLeaseOwner,
          approvalId: expectedApprovalId,
          operationId: expectedOperationId,
          invocationId: expectedInvocationId,
          campaignNonce,
          judgeAgentId: "independent-judge",
          capturedAt: "2026-07-21T02:05:01.000Z",
          startedAt: "2026-07-21T02:00:00.000Z",
          endedAt: "2026-07-21T02:05:00.000Z",
          telemetry: {
            path: `telemetry/${trialWithoutReceipt.trialId}.json`,
            sha256: "",
          },
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
        receiptBase.telemetry.sha256 = crypto
          .createHash("sha256")
          .update(telemetryContent)
          .digest("hex");
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
          runtimeHome: certificationRuntimeHome,
          observedLeaseSha256: certificationLeaseSha256,
          epochSha256: digestCertificationLeaseEpoch(certificationLeasePayload),
          state: "acquired",
          activeSha: sourceSha,
          candidateSha: sourceSha,
          rollbackSha: expectedRollbackSha,
          activeReleaseId: expectedActiveReleaseId,
          rollbackReleaseId: expectedRollbackReleaseId,
          owner: expectedLeaseOwner,
          actor: certificationLeasePayload.actor,
          approvalId: expectedApprovalId,
          operationId: expectedOperationId,
          invocationId: expectedInvocationId,
          operationClass: "release-certification" as const,
          createdAt: "2026-07-21T01:29:00.000Z",
          expiresAt: "2026-07-22T01:29:00.000Z",
          heartbeatAt: certificationLeasePayload.heartbeatAt,
          heartbeatRequired: true as const,
          heartbeatSequence: 0,
          pid: certificationLeasePayload.pid,
        };
        const invocation = {
          runId: `judge-run-${trialWithoutReceipt.trialId}`,
          sessionId: `judge-session-${trialWithoutReceipt.trialId}`,
          judgeAgentId: "independent-judge",
          provider: "ollama",
          model: "independent-judge:latest",
          startedAt: "2026-07-21T02:05:01.100Z",
          endedAt: "2026-07-21T02:05:01.400Z",
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
            parsedVerdictSha256: crypto
              .createHash("sha256")
              .update(JSON.stringify(parsed))
              .digest("hex"),
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
          issuedAt: Date.parse("2026-07-21T02:05:01.500Z"),
          trialIssuance,
        };
        const judgeReceipt = {
          ...unsignedJudgeReceipt,
          publicKeyId: judgePublicKeyId,
          signature: crypto
            .sign(null, canonicalJudgeReceiptBytes(unsignedJudgeReceipt), judgeKeyPair.privateKey)
            .toString("base64"),
        };
        const receiptWithoutDigest = {
          ...receiptBase,
          measurementReceiptSha256,
          judgeReceipt,
        };
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
      }),
    ),
  );
  const modelEval = buildControlDirectorModelEvalMatrix({
    trials,
    sourceSha,
    configurationDigest: expectedConfigDigest,
    modelRef: selectedModel,
    modelIdentity: selectedModelIdentity,
    certification: {
      runtimeHome: certificationRuntimeHome,
      rollbackSha: expectedRollbackSha,
      activeReleaseId: expectedActiveReleaseId,
      rollbackReleaseId: expectedRollbackReleaseId,
      configurationDigest: expectedConfigDigest,
      leaseOwner: expectedLeaseOwner,
      approvalId: expectedApprovalId,
      operationId: expectedOperationId,
      invocationId: expectedInvocationId,
      judgeAgentId: "independent-judge",
      judgePublicKeyPem,
      judgePublicKeyId,
      leaseAcquiredAt: "2026-07-21T01:29:00.000Z",
    },
    evaluatedAt: runtimeCheckedAt,
    verifyArtifact: (artifact) => {
      const content = modelEvalArtifactTexts.get(artifact.path);
      return (
        content !== undefined &&
        crypto.createHash("sha256").update(content).digest("hex") === artifact.sha256
      );
    },
  });
  if (!modelEval.passed) {
    throw new Error(
      `Synthetic model-evaluation fixture failed: ${JSON.stringify(modelEval.results[0]?.blockers ?? [])}`,
    );
  }
  return {
    schemaVersion: 4,
    sourceSha,
    generatedAt: runtimeCheckedAt,
    sigBackgroundEnabled: true,
    certification: {
      runtimeHome: certificationRuntimeHome,
      rollbackSha: expectedRollbackSha,
      activeReleaseId: expectedActiveReleaseId,
      rollbackReleaseId: expectedRollbackReleaseId,
      configurationDigest: expectedConfigDigest,
      leaseOwner: expectedLeaseOwner,
      approvalId: expectedApprovalId,
      operationId: expectedOperationId,
      invocationId: expectedInvocationId,
      judgeAgentId: "independent-judge",
      judgePublicKeyId,
      campaignJudgePublicKeyId,
      leaseAcquiredAt: "2026-07-21T01:29:00.000Z",
    },
    lineage: {
      status: "ready",
      sourceSha,
      checkedAt: runtimeCheckedAt,
      evidenceRefs: ["artifact:lineage"],
      selectedModel,
      artifactHash: "b".repeat(64),
      canary: { sourceSha, uiBuildId: "b".repeat(64) },
    },
    artifacts: {
      lineage: { sha256: "c".repeat(64) },
      judgePublicKey: {
        path: "judge-public.pem",
        sha256: crypto.createHash("sha256").update(judgePublicKeyPem).digest("hex"),
      },
      campaignJudgePublicKey: {
        path: "campaign-judge-public.pem",
        sha256: crypto.createHash("sha256").update(campaignJudgePublicKeyPem).digest("hex"),
      },
    },
    macStudioDashboard: macStudioDashboardSurface(1440, 900),
    localModelRouting: {
      ...surface,
      route: "local",
      modelRef: selectedModel,
      qualityScore: 100,
    },
    localModelLatency: {
      ...surface,
      cold: latencySample(20_000),
      warm: latencySample(7_000),
    },
    memory: {
      ...surface,
      recentRecallTopK: 3,
      recallPassed: true,
      provenanceVerified: true,
    },
    delegation: {
      ...surface,
      controlDirectorRunId: "run-director",
      programManagerRunId: "run-program-manager",
      workerRunId: "run-worker",
      taskRootVerified: true,
      handoffVerified: true,
    },
    judge: {
      ...surface,
      claim: judgeClaim,
      receipt: signedJudgeReceipt(),
    },
    sig: {
      ...surface,
      auditEventId: "sig-event",
      ingested: true,
      routed: true,
      backgroundEnabled: true,
    },
    pcc: {
      ...surface,
      projectId: "pcc-project",
      stateConsistent: true,
      evidenceProjectionVerified: true,
    },
    queue: {
      ...surface,
      queuedTurnId: "queued-turn",
      accepted: true,
      processed: true,
      orderPreserved: true,
    },
    steer: {
      ...surface,
      steerTurnId: "steer-turn",
      accepted: true,
      applied: true,
      activeRunPreserved: true,
    },
    cancel: {
      ...surface,
      cancelId: "cancel-run",
      accepted: true,
      workStopped: true,
      staleRunningCleared: true,
    },
    pursueGoal: {
      ...surface,
      goalId: "goal-run",
      missionId: judgeClaim.missionId,
      artifactIds: judgeClaim.artifactIds,
      startedAt: "2026-07-21T02:00:00.000Z",
      leaseObserved: true,
      progressObserved: true,
      resumeVerified: true,
      stopVerified: true,
    },
    restartRecovery: {
      ...surface,
      restartId: "restart-run",
      serviceHealthy: true,
      goalRecovered: true,
      pendingTurnsRecovered: true,
    },
    soak: runtimeSoakSurface(),
    rollback: {
      ...surface,
      rollbackSha: "b".repeat(40),
      restored: true,
      serviceHealthy: true,
    },
    liveDiagnostic: {
      ...surface,
      sessionId: "live-session",
      ackObserved: true,
      activityObserved: true,
      finalResponseReceived: true,
    },
    modelEval,
    judgeVerification: {
      publicKeyId: campaignJudgePublicKeyId,
      judgeAgentId: "independent-judge",
      judgeRunId: "judge-run",
      judgeModel: "judge-runtime/control-director-judge:latest",
      judgeProvider: "judge-runtime",
      claimHash: buildControlDirectorJudgeClaimHash(judgeClaim),
      selectedModelIdentity,
      judgeModelIdentity,
    },
  };
}

function localValidationProof() {
  const gates = [
    "targeted-tests",
    "source-check",
    "full-tests",
    "workflow-sanity",
    "build",
    "browser-mac-studio",
    "independent-review",
  ].map((id) => ({
    id,
    sourceSha,
    execution: "mac-studio-local",
    command: `local:${id}`,
    status: "passed",
    checkedAt: "2026-07-21T01:00:00.000Z",
    evidenceRefs: [`artifact:${id}`],
  }));
  return {
    schema: "openclaw.control-director-mac-studio-local-validation.v1",
    sourceSha,
    generatedAt: "2026-07-21T01:05:00.000Z",
    platform: "mac-studio",
    remoteExecutionRequired: false,
    host: {
      hardwareClass: "Mac Studio",
      osName: "macOS",
      osVersion: "15.6",
      architecture: "arm64",
      hostIdentitySha256: "e".repeat(64),
    },
    evidenceRefs: ["artifact:mac-studio-local-validation", "github:pr:33"],
    passed: true,
    gates,
    landing: {
      merged: true,
      mergeSha: sourceSha,
      pullRequest: 33,
      mergedAt: "2026-07-21T01:04:00.000Z",
      evidenceRefs: ["github:pr:33"],
    },
  };
}

function readiness() {
  const requiredFacts = [
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
    "runtime-macStudioDashboard",
    "runtime-localModelRouting",
    "runtime-localModelLatency",
    "runtime-memory",
    "runtime-delegation",
    "runtime-judge",
    "runtime-sig",
    "runtime-pcc",
    "runtime-queue",
    "runtime-steer",
    "runtime-cancel",
    "runtime-pursueGoal",
    "runtime-restartRecovery",
    "runtime-soak",
    "runtime-rollback",
    "runtime-liveDiagnostic",
  ];
  return {
    schemaVersion: 2,
    generatedAt: readinessCheckedAt,
    sourceSha,
    expectedSha: sourceSha,
    selectedModel,
    configurationDigest: expectedConfigDigest,
    roleIdentities: {
      controlDirectorAgentId: "director",
      programManagerAgentId: "program-manager",
      judgeAgentId: "independent-judge",
    },
    modelEvidence: {
      modelId: selectedModel.replace(/^ollama\//u, ""),
      manifestDigest,
      baseBlobDigests: ["3".repeat(64)],
      modelDigest,
      smokeModelId: selectedModel.replace(/^ollama\//u, ""),
    },
    cacheEvidence,
    sourceReady: true,
    productionReady: true,
    passPercent: 100,
    mode: "production",
    facts: requiredFacts.map((id) => ({ id, passed: true, critical: true })),
    failedCritical: [],
  };
}

function modelGovernanceProof() {
  const requiredFacts = [
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
  ];
  const results = runtimeProof().modelEval.results;
  return {
    schema: "openclaw.control-director-model-governance-proof.v1",
    sourceSha,
    generatedAt: modelGovernanceCheckedAt,
    passed: true,
    requiredQualityScore: 93,
    minimumQualityScore: 100,
    failedCritical: [],
    evidenceRefs: ["artifact:model-governance"],
    modelIdentity: {
      sourceSha,
      selectedModel,
      identityDigest: digestModelGovernanceIdentity({
        sourceSha,
        selectedModel,
        modelDigest,
        configDigest: expectedConfigDigest,
        cacheDigest,
      }),
      modelDigest,
      configDigest: expectedConfigDigest,
      cacheDigest,
    },
    statisticalEvaluation: {
      trialCount: 48,
      passRate: 100,
      criticalOmissions: 0,
      minimumQualityScore: 100,
      trialSetDigest: digestControlDirectorStatisticalTrials(results),
    },
    facts: requiredFacts.map((id) => ({
      id,
      passed: true,
      checkedAt: modelGovernanceCheckedAt,
      evidenceRefs: ["artifact:model-governance"],
      qualityScore: 100,
    })),
  };
}

function stabilityProof() {
  const requiredFacts = [
    "M103-chaos-suite",
    "M104-fallback-rollback-restoration",
    "M105-extended-monitoring",
    "M106-final-ledger-closure",
  ];
  const monitorStart = Date.parse("2026-07-21T02:20:00.000Z");
  const runtimeCapture = (phase: "pre-rollback" | "restored", capturedAt: string) => ({
    schema: "openclaw.control-director-runtime-identity-capture.v1" as const,
    phase,
    transitionId: phase === "pre-rollback" ? "2".repeat(64) : "9".repeat(64),
    capturedAt,
    sourceSha,
    activeReleaseId: expectedActiveReleaseId,
    configDigest: expectedConfigDigest,
    invocationId: expectedInvocationId,
    transcripts: Object.fromEntries(
      ["config", "lifecycle", "ollamaList", "ollamaModelfile", "ollamaPs", "ollamaLaunchctl"].map(
        (name, index) => [
          name,
          {
            path: `.artifacts/control-director/capture/${phase}/${name}`,
            sha256: String(index + 1).repeat(64),
          },
        ],
      ),
    ),
  });
  const cacheBinding = (
    id = "sample",
    phase: "pre-rollback" | "restored" = "restored",
    capturedAt = new Date(monitorStart).toISOString(),
  ) => ({
    path: `.artifacts/control-director/cache/${id}.json`,
    sha256: "6".repeat(64),
    receipt: { ...cacheEvidence, capture: runtimeCapture(phase, capturedAt) },
  });
  const fallbackBinding = (id = "sample", phase: "pre-rollback" | "restored" = "restored") => {
    const order = [selectedModel, "fail-closed"];
    return {
      path: `.artifacts/control-director/fallback/${id}.json`,
      sha256: "7".repeat(64),
      receipt: {
        schema: "openclaw.control-director-fallback-order.v2" as const,
        sourceSha,
        activeReleaseId: expectedActiveReleaseId,
        selectedModel,
        order,
        orderDigest: crypto.createHash("sha256").update(JSON.stringify(order)).digest("hex"),
        capture: runtimeCapture(phase, new Date(monitorStart).toISOString()),
      },
    };
  };
  const sampleAt = (checkedAtMs: number, mode: "active" | "passive") => {
    const checkedAt = new Date(checkedAtMs).toISOString();
    const capabilityObservation = {
      phase: "restored",
      sourceSha,
      releaseId: expectedActiveReleaseId,
      selectedModelId: selectedModel.replace(/^ollama\//u, ""),
      checkedAt,
      configurationDigests: [expectedConfigDigest, "e".repeat(64)],
      capabilities: Array.from({ length: 35 }, (_, index) => ({
        id: `capability-${index}`,
      })),
      contentSha256: "9".repeat(64),
    };
    const receipt: ControlDirectorStabilitySample = {
      schema: CONTROL_DIRECTOR_STABILITY_SAMPLE_SCHEMA,
      checkedAt,
      mode,
      sourceSha,
      activeReleaseId: expectedActiveReleaseId,
      selectedModel,
      configDigest: expectedConfigDigest,
      gatewayHealthy: true as const,
      capabilitiesPassed: 35 as const,
      routeDriftDetected: false as const,
      capabilityLossDetected: false as const,
      cacheDigest,
      cacheEvidence: cacheBinding("sample", "restored", checkedAt),
      capabilityObservation: {
        path: `.artifacts/control-director/capabilities/${checkedAt}.json`,
        sha256: "a".repeat(64),
        receipt: capabilityObservation,
      },
      capabilityObservationSha256: "9".repeat(64),
    };
    const binding = {
      path: `.artifacts/control-director/monitor/${receipt.checkedAt}.json`,
      sha256: "8".repeat(64),
      receipt,
    };
    return {
      ...binding,
      sampleDigest: digestControlDirectorStabilitySample(binding),
    };
  };
  const samples = [
    ...Array.from({ length: 31 }, (_, index) => sampleAt(monitorStart + index * 60_000, "active")),
    ...Array.from({ length: 289 }, (_, index) =>
      sampleAt(monitorStart + (35 + index * 5) * 60_000, "passive"),
    ),
  ];
  const receiptContracts = [
    ["acquired", "acquired", "acquired"],
    ["promoted", "promoted", "promoted"],
    ["rollbackAuthorized", "rollback-authorized", "promoted"],
    ["rolledBack", "rolled-back", "rollback-drill"],
    ["restored", "restored", "promoted"],
  ] as const;
  const receipts = Object.fromEntries(
    receiptContracts.map(([name, result, state], index) => [
      name,
      {
        path: `.artifacts/control-director/lifecycle/${result}.json`,
        sha256: String(index + 1).repeat(64),
        receipt: {
          schema: "openclaw.custom-runtime-certification-lease-receipt.v2",
          result,
          at: new Date(Date.parse("2026-07-21T02:00:00.000Z") + index * 60_000).toISOString(),
          activeSha: sourceSha,
          candidateSha: sourceSha,
          approvalId: expectedApprovalId,
          operationId: expectedOperationId,
          invocationId: expectedInvocationId,
          ...(name === "rolledBack" || name === "restored"
            ? { transitionId: String(index + 5).repeat(64) }
            : {}),
          lease: {
            activeSha: sourceSha,
            candidateSha: sourceSha,
            rollbackSha: expectedRollbackSha,
            activeReleaseId: expectedActiveReleaseId,
            rollbackReleaseId: expectedRollbackReleaseId,
            owner: expectedLeaseOwner,
            approvalId: expectedApprovalId,
            operationId: expectedOperationId,
            invocationId: expectedInvocationId,
            operationClass: "release-certification",
            state,
          },
        },
      },
    ]),
  ) as Parameters<typeof buildControlDirectorStabilityProof>[0]["restoration"]["receipts"];
  return buildControlDirectorStabilityProof({
    sourceSha,
    generatedAt: stabilityCheckedAt,
    evidenceRefs: ["artifact:stability"],
    monitoring: {
      samples,
    },
    restoration: {
      rollbackSha: expectedRollbackSha,
      activeReleaseId: expectedActiveReleaseId,
      rollbackReleaseId: expectedRollbackReleaseId,
      owner: expectedLeaseOwner,
      approvalId: expectedApprovalId,
      operationId: expectedOperationId,
      invocationId: expectedInvocationId,
      preRollbackCache: cacheBinding("pre", "pre-rollback"),
      restoredCache: cacheBinding("restored"),
      preRollbackFallbackOrder: fallbackBinding("pre", "pre-rollback"),
      restoredFallbackOrder: fallbackBinding("restored"),
      receipts,
    },
    facts: requiredFacts.map((id) => ({
      id,
      passed: true,
      checkedAt: stabilityCheckedAt,
      evidenceRefs: ["artifact:stability"],
    })),
  });
}

function validate(value = roadmap()) {
  return validateControlDirectorRoadmap({
    roadmap: value,
    sourceSha,
    expectedModel: selectedModel,
    expectedConfigDigest,
    expectedRollbackSha,
    sourceProof: sourceProof(),
    updateSurvival: updateSurvival(),
    runtimeProof: runtimeProof(),
    localValidationProof: localValidationProof(),
    readiness: readiness(),
    modelGovernanceProof: modelGovernanceProof(),
    stabilityProof: stabilityProof(),
  });
}

function milestoneAudit() {
  return {
    summary: { implemented: 106 },
    milestones: Array.from({ length: 106 }, (_, index) => ({
      id: `M${String(index + 1).padStart(2, "0")}`,
      implementation: { status: "implemented" },
    })),
  };
}

function capabilityManifest() {
  return JSON.parse(
    fs.readFileSync(path.resolve("config/custom-runtime-capabilities.json"), "utf8"),
  ) as {
    capabilities: Array<{
      id: string;
      kind: string;
      requiredPaths: string[];
    }>;
  };
}

function capabilityProof() {
  const phase = (
    phaseName: "active" | "rollback" | "restored",
    source: string,
    releaseId: string,
    checkedAt: string,
    previousObservationSha256: string | null,
  ) => {
    const probes: Record<string, Record<string, unknown>> = {
      "immutable-runtime-contract": {
        type: "process",
        commandId: "managed-launcher-verify",
        exitCode: 0,
        parsedResult: { code: "immutable-runtime-contract-ok" },
      },
      "tailscale-status": {
        type: "process",
        commandId: "tailscale-read-only-status",
        exitCode: 0,
        parsedResult: { code: "tailscale-status-ok" },
      },
      "tailscale-serve-status": {
        type: "process",
        commandId: "tailscale-read-only-serve-status",
        exitCode: 0,
        parsedResult: { code: "tailscale-serve-status-ok" },
      },
    };
    const capabilities = capabilityManifest()
      .capabilities.map((entry) => {
        const requiredPathDigests = Object.fromEntries(
          entry.requiredPaths.map((relativePath) => [relativePath, "f".repeat(64)]),
        );
        for (const probeId of CONTROL_DIRECTOR_CAPABILITY_PROBE_REQUIREMENTS[entry.id]!) {
          if (!probes[probeId]) {
            probes[probeId] = {
              type: "derived",
              commandId: "immutable-contract",
              parsedResult: {
                code: probeId.startsWith("capability-contract:")
                  ? "capability-path-contract-ok"
                  : probeId.startsWith("surface-contract:")
                    ? "dashboard-surface-contract-ok"
                    : "bundled-plugin-contract-ok",
                digest: probeId.startsWith("capability-contract:")
                  ? crypto
                      .createHash("sha256")
                      .update(
                        JSON.stringify(
                          Object.fromEntries(
                            Object.entries(requiredPathDigests).toSorted(([left], [right]) =>
                              left.localeCompare(right),
                            ),
                          ),
                        ),
                      )
                      .digest("hex")
                  : "e".repeat(64),
              },
            };
          }
        }
        return {
          id: entry.id,
          kind: entry.kind,
          requiredPathDigests,
          probeIds: [...CONTROL_DIRECTOR_CAPABILITY_PROBE_REQUIREMENTS[entry.id]!],
        };
      })
      .toSorted((left, right) => left.id.localeCompare(right.id));
    const lifecycleResults =
      phaseName === "active"
        ? ["acquired", "promoted"]
        : phaseName === "rollback"
          ? ["rollback-authorized", "rolled-back"]
          : ["restored"];
    const value = {
      schema: "openclaw.control-director-capability-observation.v2",
      phase: phaseName,
      sourceSha: source,
      releaseId,
      selectedModelId: selectedModel.replace(/^ollama\//u, ""),
      startedAt: new Date(Date.parse(checkedAt) - 1_000).toISOString(),
      checkedAt,
      configurationDigests: [expectedConfigDigest, "d".repeat(64)],
      configuration: [],
      authorizationBindings: {
        leaseOwner: expectedLeaseOwner,
        approvalId: expectedApprovalId,
        operationId: expectedOperationId,
        invocationId: expectedInvocationId,
      },
      artifactRoot: ".artifacts/control-director/capability-test",
      runtime: {},
      lifecycle: {
        lease: {},
        receipts: lifecycleResults.map((result) => ({ result })),
        restartReceipt: phaseName === "rollback" ? null : {},
      },
      capabilities,
      probes,
      previousObservationSha256,
    };
    return {
      ...value,
      contentSha256: digestControlDirectorCapabilityObservation(value),
    };
  };
  const active = phase(
    "active",
    sourceSha,
    expectedActiveReleaseId,
    "2026-07-21T02:16:00.000Z",
    null,
  );
  const rollback = phase(
    "rollback",
    expectedRollbackSha,
    expectedRollbackReleaseId,
    "2026-07-21T02:17:00.000Z",
    active.contentSha256,
  );
  const restored = phase(
    "restored",
    sourceSha,
    expectedActiveReleaseId,
    stabilityCheckedAt,
    rollback.contentSha256,
  );
  return {
    schema: "openclaw.control-director-capability-proof.v3",
    sourceSha,
    rollbackSha: expectedRollbackSha,
    selectedModelId: selectedModel.replace(/^ollama\//u, ""),
    checkedAt: stabilityCheckedAt,
    passed: true,
    configurationDigests: [expectedConfigDigest, "d".repeat(64)],
    authorizationBindings: {
      activeReleaseId: expectedActiveReleaseId,
      rollbackReleaseId: expectedRollbackReleaseId,
      rollbackSha: expectedRollbackSha,
      leaseOwner: expectedLeaseOwner,
      approvalId: expectedApprovalId,
      operationId: expectedOperationId,
      invocationId: expectedInvocationId,
    },
    observationDigests: {
      active: active.contentSha256,
      rollback: rollback.contentSha256,
      restored: restored.contentSha256,
    },
    phases: { active, rollback, restored },
  };
}

function redigestCapabilityPhases(proof: ReturnType<typeof capabilityProof>) {
  proof.phases.active.contentSha256 = digestControlDirectorCapabilityObservation(
    proof.phases.active,
  );
  proof.phases.rollback.previousObservationSha256 = proof.phases.active.contentSha256;
  proof.phases.rollback.contentSha256 = digestControlDirectorCapabilityObservation(
    proof.phases.rollback,
  );
  proof.phases.restored.previousObservationSha256 = proof.phases.rollback.contentSha256;
  proof.phases.restored.contentSha256 = digestControlDirectorCapabilityObservation(
    proof.phases.restored,
  );
  proof.observationDigests = {
    active: proof.phases.active.contentSha256,
    rollback: proof.phases.rollback.contentSha256,
    restored: proof.phases.restored.contentSha256,
  };
}

describe("Control Director final roadmap proof", () => {
  it("reopens an authority generation and rejects a fully redigested semantic forgery", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "control-director-authority-"));
    const generationRoot = path.join(repoRoot, "generation");
    const authorityPath = path.join(repoRoot, "authority.json");
    fs.mkdirSync(generationRoot);
    const authorizationBindings = {
      expectedModel: selectedModel,
      expectedConfigDigest,
      expectedSecondaryConfigDigest: "e".repeat(64),
      expectedRollbackSha,
      expectedActiveReleaseId,
      expectedRollbackReleaseId,
      expectedLeaseOwner,
      expectedApprovalId,
      expectedOperationId,
      expectedInvocationId,
      expectedJudgePublicKeyId: judgePublicKeyId,
      expectedCampaignJudgePublicKeyId: campaignJudgePublicKeyId,
    };
    const expected = { sourceSha, authorizationBindings };
    const writeGeneration = (semanticStatus: string) => {
      const ledgerPath = path.join(generationRoot, "ledger.json");
      const projectionPath = path.join(generationRoot, "certified-roadmap.json");
      fs.writeFileSync(
        ledgerPath,
        `${JSON.stringify({
          checkedAt: stabilityCheckedAt,
          authorizationBindings,
          semanticStatus,
        })}\n`,
      );
      fs.writeFileSync(projectionPath, `${JSON.stringify({ status: "passed" })}\n`);
      const ledgerSha256 = crypto
        .createHash("sha256")
        .update(fs.readFileSync(ledgerPath))
        .digest("hex");
      const projectionSha256 = crypto
        .createHash("sha256")
        .update(fs.readFileSync(projectionPath))
        .digest("hex");
      const manifestPath = path.join(generationRoot, "manifest.json");
      fs.writeFileSync(
        manifestPath,
        `${JSON.stringify({
          schema: "openclaw.control-director-final-ledger-generation.v1",
          sourceSha,
          checkedAt: stabilityCheckedAt,
          ledger: { path: "generation/ledger.json", sha256: ledgerSha256 },
          certifiedProjection: {
            path: "generation/certified-roadmap.json",
            sha256: projectionSha256,
          },
        })}\n`,
      );
      const manifestSha256 = crypto
        .createHash("sha256")
        .update(fs.readFileSync(manifestPath))
        .digest("hex");
      fs.writeFileSync(
        authorityPath,
        `${JSON.stringify(
          buildControlDirectorFinalLedgerAuthority({
            sourceSha,
            checkedAt: stabilityCheckedAt,
            manifestPath: "generation/manifest.json",
            manifestSha256,
            ledgerPath: "generation/ledger.json",
            ledgerSha256,
            projectionPath: "generation/certified-roadmap.json",
            projectionSha256,
          }),
        )}\n`,
      );
    };
    const semanticVerifier = ({ ledger }: { ledger: Record<string, unknown> }) => {
      if (ledger.semanticStatus !== "passed") {
        throw new Error("independent semantic verification failed");
      }
      return { passed: true };
    };
    try {
      writeGeneration("passed");
      expect(
        verifyControlDirectorFinalLedgerAuthority({
          repoRoot,
          authorityPath,
          expected,
          semanticVerifier,
        }),
      ).toMatchObject({ sourceSha, validation: { passed: true } });

      writeGeneration("forged");
      expect(() =>
        verifyControlDirectorFinalLedgerAuthority({
          repoRoot,
          authorityPath,
          expected,
          semanticVerifier,
        }),
      ).toThrow("independent semantic verification failed");
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("binds ledger and projection digests through one final authority pointer", () => {
    expect(
      (roadmap().evidenceBinding as Record<string, unknown>).certifiedProjection,
    ).toBeUndefined();
    expect(
      buildControlDirectorFinalLedgerAuthority({
        sourceSha,
        checkedAt: stabilityCheckedAt,
        manifestPath: "generation/manifest.json",
        manifestSha256: "1".repeat(64),
        ledgerPath: "generation/ledger.json",
        ledgerSha256: "2".repeat(64),
        projectionPath: "generation/certified-roadmap.json",
        projectionSha256: "3".repeat(64),
      }),
    ).toEqual({
      schema: "openclaw.control-director-final-ledger-authority.v1",
      sourceSha,
      checkedAt: stabilityCheckedAt,
      generationManifest: {
        path: "generation/manifest.json",
        sha256: "1".repeat(64),
      },
      ledger: { path: "generation/ledger.json", sha256: "2".repeat(64) },
      certifiedProjection: {
        path: "generation/certified-roadmap.json",
        sha256: "3".repeat(64),
      },
      committed: true,
    });
  });

  it("accepts only the canonical tracked roadmap specification path", () => {
    expect(
      controlDirectorRoadmapPathMatchesCanonical(
        path.resolve("work/control-director/reliability-v1/roadmap.json"),
        path.resolve("."),
      ),
    ).toBe(true);
    expect(
      controlDirectorRoadmapPathMatchesCanonical(
        path.resolve(".artifacts/control-director/synthetic-roadmap.json"),
        path.resolve("."),
      ),
    ).toBe(false);
  });

  it("builds a private 106-milestone projection without mutating the tracked specification", () => {
    const specification = roadmap();
    const before = JSON.stringify(specification);
    const finalReceiptPath = `.artifacts/control-director/final-ledger-${sourceSha}.json`;
    const finalReceiptSha256 = "9".repeat(64);
    const projection = buildCertifiedControlDirectorRoadmapProjection({
      roadmap: specification,
      milestoneAudit: milestoneAudit(),
      finalReceiptPath,
      finalReceiptSha256,
    }) as Record<string, unknown>;

    expect(JSON.stringify(specification)).toBe(before);
    expect(
      (projection.milestones as Array<Record<string, unknown>>).every(
        (milestone) =>
          milestone.status === "passed" &&
          milestone.implementationStatus === "implemented" &&
          milestone.certificationStatus === "passed" &&
          !(milestone.evidence as string[]).some((entry) => entry.includes("synthetic")),
      ),
    ).toBe(true);
    expect(
      (projection.milestones as Array<Record<string, unknown>>).find(
        (milestone) => milestone.id === "M106",
      )?.evidence,
    ).toContain(`ledger:${finalReceiptPath}#sha256=${finalReceiptSha256}`);

    expect(
      validateControlDirectorRoadmap({
        roadmap: projection,
        sourceSha,
        expectedModel: selectedModel,
        expectedConfigDigest,
        expectedSecondaryConfigDigest: "d".repeat(64),
        expectedRollbackSha,
        expectedActiveReleaseId,
        expectedRollbackReleaseId,
        expectedLeaseOwner,
        expectedApprovalId,
        expectedOperationId,
        expectedInvocationId,
        capabilityManifest: capabilityManifest(),
        capabilityProof: capabilityProof(),
        requireProjectionContract: true,
        finalReceiptPath,
        finalReceiptSha256,
        sourceProof: sourceProof(),
        updateSurvival: updateSurvival(),
        runtimeProof: runtimeProof(),
        localValidationProof: localValidationProof(),
        readiness: readiness(),
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
      }),
    ).toMatchObject({
      milestoneCount: 106,
      passedMilestones: 106,
      certificationPercent: 100,
    });
  });

  it("rejects incomplete milestone audits and capability ledgers", () => {
    const incompleteAudit = milestoneAudit();
    incompleteAudit.summary.implemented = 105;
    expect(() =>
      buildCertifiedControlDirectorRoadmapProjection({
        roadmap: roadmap(),
        milestoneAudit: incompleteAudit,
      }),
    ).toThrow("all 106 implementation contracts");

    const weakCapabilities = capabilityProof();
    weakCapabilities.phases.rollback.capabilities.pop();
    redigestCapabilityPhases(weakCapabilities);
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        expectedModel: selectedModel,
        expectedConfigDigest,
        expectedSecondaryConfigDigest: "d".repeat(64),
        expectedRollbackSha,
        expectedActiveReleaseId,
        expectedRollbackReleaseId,
        expectedLeaseOwner,
        expectedApprovalId,
        expectedOperationId,
        expectedInvocationId,
        capabilityManifest: capabilityManifest(),
        capabilityProof: weakCapabilities,
        sourceProof: sourceProof(),
        updateSurvival: updateSurvival(),
        runtimeProof: runtimeProof(),
        localValidationProof: localValidationProof(),
        readiness: readiness(),
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
      }),
    ).toThrow("exactly the 35 manifest capabilities");
  });

  it("independently rejects fabricated capability outcomes, chain drift, and phase drift", () => {
    const base = {
      roadmap: roadmap(),
      sourceSha,
      expectedModel: selectedModel,
      expectedConfigDigest,
      expectedSecondaryConfigDigest: "d".repeat(64),
      expectedRollbackSha,
      expectedActiveReleaseId,
      expectedRollbackReleaseId,
      expectedLeaseOwner,
      expectedApprovalId,
      expectedOperationId,
      expectedInvocationId,
      capabilityManifest: capabilityManifest(),
      sourceProof: sourceProof(),
      updateSurvival: updateSurvival(),
      runtimeProof: runtimeProof(),
      localValidationProof: localValidationProof(),
      readiness: readiness(),
      modelGovernanceProof: modelGovernanceProof(),
      stabilityProof: stabilityProof(),
    };

    const fabricated = capabilityProof();
    (fabricated.phases.rollback as Record<string, unknown>).passed = true;
    expect(() => validateControlDirectorRoadmap({ ...base, capabilityProof: fabricated })).toThrow(
      "forbidden caller-authored capability outcome",
    );

    const brokenChain = capabilityProof();
    brokenChain.phases.restored.previousObservationSha256 = "0".repeat(64);
    brokenChain.phases.restored.contentSha256 = digestControlDirectorCapabilityObservation(
      brokenChain.phases.restored,
    );
    brokenChain.observationDigests.restored = brokenChain.phases.restored.contentSha256;
    expect(() => validateControlDirectorRoadmap({ ...base, capabilityProof: brokenChain })).toThrow(
      "digest, chain, or order",
    );

    const configDrift = capabilityProof();
    configDrift.phases.rollback.configurationDigests[0] = "0".repeat(64);
    redigestCapabilityPhases(configDrift);
    expect(() => validateControlDirectorRoadmap({ ...base, capabilityProof: configDrift })).toThrow(
      "digest, chain, or order",
    );

    const phaseDrift = capabilityProof();
    phaseDrift.phases.rollback.sourceSha = sourceSha;
    redigestCapabilityPhases(phaseDrift);
    expect(() => validateControlDirectorRoadmap({ ...base, capabilityProof: phaseDrift })).toThrow(
      "digest, chain, or order",
    );

    const probeFailure = capabilityProof();
    probeFailure.phases.active.probes["immutable-runtime-contract"].exitCode = 1;
    redigestCapabilityPhases(probeFailure);
    expect(() =>
      validateControlDirectorRoadmap({ ...base, capabilityProof: probeFailure }),
    ).toThrow("does not derive a successful result");

    const contractDigestDrift = capabilityProof();
    contractDigestDrift.phases.active.probes[
      "capability-contract:dashboard:pcc"
    ].parsedResult.digest = "0".repeat(64);
    redigestCapabilityPhases(contractDigestDrift);
    expect(() =>
      validateControlDirectorRoadmap({ ...base, capabilityProof: contractDigestDrift }),
    ).toThrow("exact immutable manifest and probes");

    const probeRegistryDrift = capabilityProof();
    probeRegistryDrift.phases.active.capabilities[0]!.probeIds =
      probeRegistryDrift.phases.active.capabilities[0]!.probeIds.slice(0, 1);
    redigestCapabilityPhases(probeRegistryDrift);
    expect(() =>
      validateControlDirectorRoadmap({ ...base, capabilityProof: probeRegistryDrift }),
    ).toThrow("exact immutable manifest and probes");
  });

  it("requires the source receipt to name the current canonical source root", () => {
    expect(controlDirectorSourceProofMatchesRoot("/tmp/repo", "/tmp/repo")).toBe(true);
    expect(controlDirectorSourceProofMatchesRoot("/tmp/other", "/tmp/repo")).toBe(false);
    expect(controlDirectorSourceProofMatchesRoot(undefined, "/tmp/repo")).toBe(false);
  });

  it("accepts only the complete 106-milestone exact-proof ledger", () => {
    expect(validate()).toMatchObject({
      milestoneCount: 106,
      passedMilestones: 106,
      implementedMilestones: 106,
      certifiedMilestones: 106,
      implementationPercent: 100,
      certificationPercent: 100,
      weightedCompletionPercent: 100,
      minimumQualityScore: 100,
      requiredQualityScore: 93,
      judgeDiversity: {
        judgeAgentId: "independent-judge",
        judgeModel: "judge-runtime/control-director-judge:latest",
        judgeProvider: "judge-runtime",
        independentRoute: true,
        modelDistinct: true,
        cacheDistinct: true,
        providerDistinct: true,
        conflicts: [],
      },
    });
  });

  it("rejects receipts that drift from the authorized model, config, or rollback identities", () => {
    const evidence = {
      roadmap: roadmap(),
      sourceSha,
      expectedModel: selectedModel,
      expectedConfigDigest,
      expectedRollbackSha,
      sourceProof: sourceProof(),
      updateSurvival: updateSurvival(),
      runtimeProof: runtimeProof(),
      localValidationProof: localValidationProof(),
      readiness: readiness(),
      modelGovernanceProof: modelGovernanceProof(),
      stabilityProof: stabilityProof(),
    };

    expect(() =>
      validateControlDirectorRoadmap({
        ...evidence,
        expectedModel: "ollama/not-authorized:latest",
      }),
    ).toThrow("authorized model");
    expect(() =>
      validateControlDirectorRoadmap({
        ...evidence,
        expectedConfigDigest: "0".repeat(64),
      }),
    ).toThrow("runtime receipt configuration digest");
    expect(() =>
      validateControlDirectorRoadmap({
        ...evidence,
        expectedRollbackSha: "c".repeat(40),
      }),
    ).toThrow("exact monitoring and lifecycle receipts");

    const releaseDrift = stabilityProof();
    releaseDrift.restoration.activeReleaseId = "release-other";
    expect(() =>
      validateControlDirectorRoadmap({
        ...evidence,
        expectedActiveReleaseId,
        expectedRollbackReleaseId,
        stabilityProof: releaseDrift,
      }),
    ).toThrow("restored active release");

    const fabricatedDuration = stabilityProof();
    fabricatedDuration.monitoring.passiveMonitorHours = 999;
    expect(() =>
      validateControlDirectorRoadmap({
        ...evidence,
        stabilityProof: fabricatedDuration,
      }),
    ).toThrow("exact monitoring and lifecycle receipts");

    const tamperedLifecycle = stabilityProof();
    tamperedLifecycle.restoration.receipts.restored.receipt.lease = {
      ...(tamperedLifecycle.restoration.receipts.restored.receipt.lease as Record<string, unknown>),
      state: "rollback-drill",
    };
    expect(() =>
      validateControlDirectorRoadmap({
        ...evidence,
        stabilityProof: tamperedLifecycle,
      }),
    ).toThrow("restored has invalid exact bindings");

    expect(() =>
      validateControlDirectorRoadmap({
        ...evidence,
        verifyStabilityArtifact: () => false,
      }),
    ).toThrow("failed digest verification");
    expect(() =>
      validateControlDirectorRoadmap({
        ...evidence,
        verifyRuntimeIdentityEvidence: () => {
          throw new Error("raw runtime transcript replay failed");
        },
      }),
    ).toThrow("raw runtime transcript replay failed");

    const forgedSampleObservation = stabilityProof();
    forgedSampleObservation.monitoring.samples[0].receipt.capabilityObservation.receipt.checkedAt =
      "2026-07-21T02:20:01.000Z";
    expect(() =>
      validateControlDirectorRoadmap({
        ...evidence,
        stabilityProof: forgedSampleObservation,
      }),
    ).toThrow("does not match its sample");
  });

  it("rejects a pending milestone, missing evidence, stale SHA, or weak quality", () => {
    const pending = structuredClone(roadmap()) as {
      milestones: Array<{
        certificationStatus: string;
        status: string;
        evidence: string[];
      }>;
    };
    pending.milestones[0]!.status = "pending";
    pending.milestones[0]!.certificationStatus = "pending";
    expect(() => validate(pending)).toThrow("M01 is not passed");

    const missingEvidence = structuredClone(roadmap()) as {
      milestones: Array<{ status: string; evidence: string[] }>;
    };
    missingEvidence.milestones[0]!.evidence = [];
    expect(() => validate(missingEvidence)).toThrow("M01 requires at least two");

    const staleSource = sourceProof();
    staleSource.sourceSha = "b".repeat(40);
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: staleSource,
        updateSurvival: updateSurvival(),
        runtimeProof: runtimeProof(),
        localValidationProof: localValidationProof(),
        readiness: readiness(),
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
      }),
    ).toThrow("sourceProof sourceSha");

    const weakRuntime = runtimeProof();
    weakRuntime.modelEval.results[0]!.quality.score = 92;
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: sourceProof(),
        updateSurvival: updateSurvival(),
        runtimeProof: weakRuntime,
        localValidationProof: localValidationProof(),
        readiness: readiness(),
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
      }),
    ).not.toThrow();

    const weakMeasuredRuntime = runtimeProof();
    const weakTrial = weakMeasuredRuntime.modelEval.results[0]!.trial;
    weakTrial.instructionCoveragePercent = 92;
    const {
      receiptSha256: _receiptSha256,
      signature: _signature,
      publicKeyId: _publicKeyId,
      ...receiptWithoutDigest
    } = weakTrial.runtimeReceipt;
    const { runtimeReceipt: _runtimeReceipt, ...trialWithoutReceipt } = weakTrial;
    const replacementReceiptSha256 = digestControlDirectorModelEvalTrialReceipt(
      trialWithoutReceipt,
      receiptWithoutDigest,
    );
    const replacementPayload = buildControlDirectorModelEvalTrialSignedPayload(
      trialWithoutReceipt,
      {
        ...receiptWithoutDigest,
        receiptSha256: replacementReceiptSha256,
      },
    );
    weakTrial.runtimeReceipt.receiptSha256 = replacementReceiptSha256;
    weakTrial.runtimeReceipt.signature = crypto
      .sign(null, canonicalJudgeReceiptBytes(replacementPayload), judgeKeyPair.privateKey)
      .toString("base64");
    weakMeasuredRuntime.modelEval = buildControlDirectorModelEvalMatrix({
      trials: weakMeasuredRuntime.modelEval.results.map((result) => result.trial),
      sourceSha,
      configurationDigest: expectedConfigDigest,
      modelRef: selectedModel,
      modelIdentity: selectedModelIdentity,
      certification: {
        activeReleaseId: expectedActiveReleaseId,
        rollbackReleaseId: expectedRollbackReleaseId,
        leaseOwner: expectedLeaseOwner,
        approvalId: expectedApprovalId,
        operationId: expectedOperationId,
        invocationId: expectedInvocationId,
        judgeAgentId: "independent-judge",
        judgePublicKeyPem,
        judgePublicKeyId,
      },
      evaluatedAt: runtimeCheckedAt,
      verifyArtifact: () => true,
    });
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: sourceProof(),
        updateSurvival: updateSurvival(),
        runtimeProof: weakMeasuredRuntime,
        localValidationProof: localValidationProof(),
        readiness: readiness(),
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
      }),
    ).toThrow("100% exact-runtime pass");

    const staleModelEval = runtimeProof();
    staleModelEval.modelEval.sourceSha = "b".repeat(40);
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: sourceProof(),
        updateSurvival: updateSurvival(),
        runtimeProof: staleModelEval,
        localValidationProof: localValidationProof(),
        readiness: readiness(),
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
      }),
    ).toThrow("runtimeProof.modelEval sourceSha");

    const incompleteCoverage = runtimeProof();
    incompleteCoverage.modelEval.results = incompleteCoverage.modelEval.results.filter(
      (result) => !(result.trial.taskClass === "conversation" && result.trial.cold),
    );
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: sourceProof(),
        updateSurvival: updateSurvival(),
        runtimeProof: incompleteCoverage,
        localValidationProof: localValidationProof(),
        readiness: readiness(),
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
      }),
    ).toThrow("verified exact-runtime trial receipts");

    const weakReadiness = readiness();
    weakReadiness.facts[0]!.passed = false;
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: sourceProof(),
        updateSurvival: updateSurvival(),
        runtimeProof: runtimeProof(),
        localValidationProof: localValidationProof(),
        readiness: weakReadiness,
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
      }),
    ).toThrow("all-passed fact ledger");

    const prematureSource = sourceProof();
    prematureSource.completedAt = "2026-07-17T23:59:59.000Z";
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: prematureSource,
        updateSurvival: updateSurvival(),
        runtimeProof: runtimeProof(),
        localValidationProof: localValidationProof(),
        readiness: readiness(),
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
      }),
    ).toThrow("clean exact-identity v2 pass");
  });

  it("reports implementation and certification coverage separately", () => {
    const pending = JSON.parse(
      fs.readFileSync(path.resolve("work/control-director/reliability-v1/roadmap.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(summarizeControlDirectorProgress(pending)).toMatchObject({
      milestoneCount: 106,
      implementedMilestones: 38,
      certifiedMilestones: 4,
      implementationPercent: 35.85,
      certificationPercent: 3.77,
    });
  });

  it("rejects contradictory progress, missing execution milestones, and dependency cycles", () => {
    const contradictory = structuredClone(roadmap()) as {
      milestones: Array<{ certificationStatus: string; status: string }>;
    };
    contradictory.milestones[68]!.status = "pending";
    expect(() => summarizeControlDirectorProgress(contradictory)).toThrow(
      "M69 status does not mirror certificationStatus",
    );

    const missingExecution = structuredClone(roadmap()) as {
      executionWaves: Array<{ milestones: string[] }>;
    };
    missingExecution.executionWaves.at(-1)!.milestones = [];
    expect(() => summarizeControlDirectorProgress(missingExecution)).toThrow(
      "Execution waves omit expanded milestones: M103",
    );

    const cyclic = structuredClone(roadmap()) as {
      milestones: Array<{ dependsOn: string[] }>;
    };
    cyclic.milestones[0]!.dependsOn = ["M106"];
    cyclic.milestones[105]!.dependsOn.push("M01");
    expect(() => summarizeControlDirectorProgress(cyclic)).toThrow(
      "dependency graph contains a cycle",
    );
  });

  it("rejects abbreviated or unauditable Mac Studio-local validation evidence", () => {
    const abbreviatedLocal = localValidationProof();
    abbreviatedLocal.gates = abbreviatedLocal.gates.filter((gate) => gate.id !== "workflow-sanity");
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: sourceProof(),
        updateSurvival: updateSurvival(),
        runtimeProof: runtimeProof(),
        localValidationProof: abbreviatedLocal,
        readiness: readiness(),
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
      }),
    ).toThrow("does not contain every exact-SHA all-passed local gate");

    const unboundLanding = localValidationProof();
    unboundLanding.landing.evidenceRefs = [];
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: sourceProof(),
        updateSurvival: updateSurvival(),
        runtimeProof: runtimeProof(),
        localValidationProof: unboundLanding,
        readiness: readiness(),
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
      }),
    ).toThrow("Landing does not bind the exact locally validated source SHA");
  });

  it("rejects remote certification policy and non-Mac-Studio local evidence", () => {
    const remoteRoadmap = roadmap() as {
      completionPolicy: { remoteExecutionRequired: boolean; truthSurfaces: string[] };
    };
    remoteRoadmap.completionPolicy.remoteExecutionRequired = true;
    remoteRoadmap.completionPolicy.truthSurfaces.push("remote-ci");
    expect(() => validate(remoteRoadmap)).toThrow(
      "Roadmap completion policy is weaker than the required contract",
    );

    const wrongHost = localValidationProof();
    wrongHost.host.hardwareClass = "MacBook Pro";
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: sourceProof(),
        updateSurvival: updateSurvival(),
        runtimeProof: runtimeProof(),
        localValidationProof: wrongHost,
        readiness: readiness(),
      }),
    ).toThrow("privacy-safe arm64 Mac Studio identity");
  });

  it("rejects proof assembled out of source, local validation, landing, and runtime order", () => {
    const lateSource = sourceProof();
    lateSource.completedAt = "2026-07-21T01:06:00.000Z";
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: lateSource,
        updateSurvival: updateSurvival(),
        runtimeProof: runtimeProof(),
        localValidationProof: localValidationProof(),
        readiness: readiness(),
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
      }),
    ).toThrow("Exact-source proof must complete before the local validation bundle");

    const preLandingRuntime = runtimeProof();
    preLandingRuntime.generatedAt = "2026-07-21T01:03:00.000Z";
    preLandingRuntime.lineage.checkedAt = "2026-07-21T01:03:00.000Z";
    preLandingRuntime.modelEval.evaluatedAt = "2026-07-21T01:03:00.000Z";
    for (const surface of [
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
    ] as const) {
      preLandingRuntime[surface].checkedAt = "2026-07-21T01:03:00.000Z";
    }
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: sourceProof(),
        updateSurvival: updateSurvival(),
        runtimeProof: preLandingRuntime,
        localValidationProof: localValidationProof(),
        readiness: readiness(),
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
      }),
    ).toThrow("soak verification requires a bounded certification window");
  });

  it("rejects weakened or unbound M61 update-survival evidence", () => {
    const weakened = updateSurvival();
    weakened.dashboardChangePolicy = "ignore";
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: sourceProof(),
        updateSurvival: weakened,
        runtimeProof: runtimeProof(),
        localValidationProof: localValidationProof(),
        readiness: readiness(),
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
      }),
    ).toThrow("Update-survival proof");

    const abbreviatedSource = sourceProof();
    abbreviatedSource.commands = abbreviatedSource.commands.filter(
      (command) => command.id !== "protocol-coverage",
    );
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: abbreviatedSource,
        updateSurvival: updateSurvival(),
        runtimeProof: runtimeProof(),
        localValidationProof: localValidationProof(),
        readiness: readiness(),
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
      }),
    ).toThrow("protocol-coverage");

    const abbreviatedUpdate = updateSurvival();
    abbreviatedUpdate.facts = abbreviatedUpdate.facts.filter(
      (fact) => fact.id !== "exact-parent-update-broker",
    );
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: sourceProof(),
        updateSurvival: abbreviatedUpdate,
        runtimeProof: runtimeProof(),
        localValidationProof: localValidationProof(),
        readiness: readiness(),
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
      }),
    ).toThrow("exact-parent-update-broker");

    const unbound = roadmap() as {
      milestones: Array<{ id: string; evidence: string[] }>;
    };
    unbound.milestones.find((milestone) => milestone.id === "M61")!.evidence = [
      "binding:sourceProof",
      "test:update-survival",
    ];
    expect(() => validate(unbound)).toThrow("M61 is not bound to updateSurvival");

    const weakReadiness = readiness();
    weakReadiness.facts = weakReadiness.facts.filter((fact) => fact.id !== "runtime-update-broker");
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: sourceProof(),
        updateSurvival: updateSurvival(),
        runtimeProof: runtimeProof(),
        localValidationProof: localValidationProof(),
        readiness: weakReadiness,
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
      }),
    ).toThrow("runtime-update-broker");
  });

  it("independently rejects fabricated runtime-surface passes", () => {
    const obstructed = runtimeProof();
    obstructed.macStudioDashboard.truthCompletionOverlapFree = false;
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: sourceProof(),
        updateSurvival: updateSurvival(),
        runtimeProof: obstructed,
        localValidationProof: localValidationProof(),
        readiness: readiness(),
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
      }),
    ).toThrow("runtimeProof.macStudioDashboard.truthCompletionOverlapFree must be true");

    const unsignedJudge = runtimeProof();
    unsignedJudge.judge.receipt.signature = "tampered";
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: sourceProof(),
        updateSurvival: updateSurvival(),
        runtimeProof: unsignedJudge,
        localValidationProof: localValidationProof(),
        readiness: readiness(),
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
      }),
    ).toThrow("signature does not match the trusted public key");

    const changedClaim = runtimeProof();
    changedClaim.judge.claim.finalText = "Changed after the Judge signed.";
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: sourceProof(),
        updateSurvival: updateSurvival(),
        runtimeProof: changedClaim,
        localValidationProof: localValidationProof(),
        readiness: readiness(),
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
      }),
    ).toThrow("does not bind the exact completion claim");

    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: sourceProof(),
        updateSurvival: updateSurvival(),
        runtimeProof: runtimeProof(),
        localValidationProof: localValidationProof(),
        readiness: readiness(),
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
        expectedCampaignJudgePublicKeyId: "f".repeat(64),
      }),
    ).toThrow("campaign Judge public key artifact is not a distinct trusted key binding");

    const wrongKey = crypto.generateKeyPairSync("ed25519");
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: sourceProof(),
        updateSurvival: updateSurvival(),
        runtimeProof: runtimeProof(),
        localValidationProof: localValidationProof(),
        readiness: readiness(),
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
        judgePublicKeyPem: wrongKey.publicKey.export({ type: "spki", format: "pem" }),
      }),
    ).toThrow("public key artifact does not match the trusted key bytes");

    const legacyRuntimeProof = runtimeProof();
    legacyRuntimeProof.schemaVersion = 3;
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: sourceProof(),
        updateSurvival: updateSurvival(),
        runtimeProof: legacyRuntimeProof,
        localValidationProof: localValidationProof(),
        readiness: readiness(),
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
      }),
    ).toThrow("SIG-enabled v4 contract");

    const reusedJudgeIdentity = readiness();
    reusedJudgeIdentity.roleIdentities.judgeAgentId = "director";
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: sourceProof(),
        updateSurvival: updateSurvival(),
        runtimeProof: runtimeProof(),
        localValidationProof: localValidationProof(),
        readiness: reusedJudgeIdentity,
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
      }),
    ).toThrow("operational role identities are not independent");

    const disabledSigBackground = runtimeProof();
    disabledSigBackground.sig.backgroundEnabled = false;
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: sourceProof(),
        updateSurvival: updateSurvival(),
        runtimeProof: disabledSigBackground,
        localValidationProof: localValidationProof(),
        readiness: readiness(),
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
      }),
    ).toThrow("runtimeProof.sig.backgroundEnabled must be true");

    const slowLocalModel = runtimeProof();
    slowLocalModel.localModelLatency.warm.ackMs = 60_000;
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: sourceProof(),
        updateSurvival: updateSurvival(),
        runtimeProof: slowLocalModel,
        localValidationProof: localValidationProof(),
        readiness: readiness(),
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
      }),
    ).toThrow("runtimeProof.localModelLatency.warm.ackMs exceeds");
  });
});

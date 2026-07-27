import { describe, expect, it } from "vitest";
import {
  CONTROL_DIRECTOR_MODEL_GOVERNANCE_FACT_IDS,
  CONTROL_DIRECTOR_STABILITY_FACT_IDS,
  buildControlDirectorModelGovernanceProof,
  buildControlDirectorStabilityProof,
  digestModelGovernanceIdentity,
} from "./control-director-model-governance-proof.ts";

const sourceSha = "a".repeat(40);
const checkedAt = "2026-07-27T12:00:00.000Z";

function modelFacts() {
  return CONTROL_DIRECTOR_MODEL_GOVERNANCE_FACT_IDS.map((id) => ({
    id,
    passed: true as const,
    checkedAt,
    evidenceRefs: [`artifact:${id}`],
    qualityScore: 100,
  }));
}

function stabilityFacts() {
  return CONTROL_DIRECTOR_STABILITY_FACT_IDS.map((id) => ({
    id,
    passed: true as const,
    checkedAt,
    evidenceRefs: [`artifact:${id}`],
  }));
}

describe("Control Director model governance proof", () => {
  it("binds model identity, fact coverage, and 48-trial statistical evidence", () => {
    const identityDigest = digestModelGovernanceIdentity({
      sourceSha,
      selectedModel: "ollama/openclaw-control-qwen25-32b:latest",
      modelDigest: "b".repeat(64),
      configDigest: "c".repeat(64),
      cacheDigest: "d".repeat(64),
    });
    expect(identityDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      buildControlDirectorModelGovernanceProof({
        sourceSha,
        selectedModel: "ollama/openclaw-control-qwen25-32b:latest",
        identityDigest,
        configDigest: "c".repeat(64),
        generatedAt: checkedAt,
        statisticalEvaluation: {
          trialCount: 48,
          passRate: 100,
          criticalOmissions: 0,
          minimumQualityScore: 100,
        },
        evidenceRefs: ["artifact:model-governance"],
        facts: modelFacts(),
      }),
    ).toMatchObject({ passed: true, minimumQualityScore: 100 });
  });

  it("fails closed on missing facts or a weak statistical evaluation", () => {
    expect(() =>
      buildControlDirectorModelGovernanceProof({
        sourceSha,
        selectedModel: "ollama/openclaw-control-qwen25-32b:latest",
        identityDigest: "b".repeat(64),
        configDigest: "c".repeat(64),
        generatedAt: checkedAt,
        statisticalEvaluation: {
          trialCount: 47,
          passRate: 100,
          criticalOmissions: 0,
          minimumQualityScore: 100,
        },
        evidenceRefs: ["artifact:model-governance"],
        facts: modelFacts(),
      }),
    ).toThrow("48 all-passing");

    expect(() =>
      buildControlDirectorModelGovernanceProof({
        sourceSha,
        selectedModel: "ollama/openclaw-control-qwen25-32b:latest",
        identityDigest: "b".repeat(64),
        configDigest: "c".repeat(64),
        generatedAt: checkedAt,
        statisticalEvaluation: {
          trialCount: 48,
          passRate: 100,
          criticalOmissions: 0,
          minimumQualityScore: 100,
        },
        evidenceRefs: ["artifact:model-governance"],
        facts: modelFacts().slice(1),
      }),
    ).toThrow("M87-model-admission-identity");
  });
});

describe("Control Director stability proof", () => {
  it("requires clean monitoring, restoration, and stability fact coverage", () => {
    expect(
      buildControlDirectorStabilityProof({
        sourceSha,
        generatedAt: checkedAt,
        evidenceRefs: ["artifact:stability"],
        monitoring: {
          activeSoakMinutes: 30,
          passiveMonitorHours: 24,
          routeDriftDetected: false,
          capabilityLossDetected: false,
        },
        restoration: {
          rollbackRestored: true,
          fallbackOrderRestored: true,
          cacheIdentityRestored: true,
          proofStateRestored: true,
        },
        facts: stabilityFacts(),
      }),
    ).toMatchObject({ passed: true });
  });

  it("fails closed on route drift or incomplete restoration", () => {
    expect(() =>
      buildControlDirectorStabilityProof({
        sourceSha,
        generatedAt: checkedAt,
        evidenceRefs: ["artifact:stability"],
        monitoring: {
          activeSoakMinutes: 30,
          passiveMonitorHours: 24,
          routeDriftDetected: true,
          capabilityLossDetected: false,
        },
        restoration: {
          rollbackRestored: true,
          fallbackOrderRestored: true,
          cacheIdentityRestored: true,
          proofStateRestored: true,
        },
        facts: stabilityFacts(),
      }),
    ).toThrow("Stability monitoring");

    expect(() =>
      buildControlDirectorStabilityProof({
        sourceSha,
        generatedAt: checkedAt,
        evidenceRefs: ["artifact:stability"],
        monitoring: {
          activeSoakMinutes: 30,
          passiveMonitorHours: 24,
          routeDriftDetected: false,
          capabilityLossDetected: false,
        },
        restoration: {
          rollbackRestored: true,
          fallbackOrderRestored: false,
          cacheIdentityRestored: true,
          proofStateRestored: true,
        },
        facts: stabilityFacts(),
      }),
    ).toThrow("Stability restoration");
  });
});

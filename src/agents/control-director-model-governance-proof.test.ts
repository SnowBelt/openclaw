import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CONTROL_DIRECTOR_MODEL_GOVERNANCE_FACT_IDS,
  CONTROL_DIRECTOR_STABILITY_FACT_IDS,
  CONTROL_DIRECTOR_STABILITY_SAMPLE_SCHEMA,
  buildControlDirectorModelGovernanceProof,
  buildControlDirectorCacheIdentityEvidence,
  buildControlDirectorStabilityProof,
  digestControlDirectorStabilitySample,
  digestModelGovernanceIdentity,
  type ControlDirectorStabilitySample,
} from "./control-director-model-governance-proof.ts";

const sourceSha = "a".repeat(40);
const checkedAt = "2026-07-27T12:00:00.000Z";
const stabilityStart = Date.parse("2026-07-27T12:05:00.000Z");
const stabilityGeneratedAt = "2026-07-28T12:41:00.000Z";
const manifestDigest = "4".repeat(64);

function cacheEvidence() {
  return buildControlDirectorCacheIdentityEvidence({
    selectedModel: "ollama/openclaw-control-qwen25-32b:latest",
    modelId: "openclaw-control-qwen25-32b:latest",
    modelDigest: "b".repeat(64),
    manifestDigest,
    baseBlobDigests: ["e".repeat(64)],
    kvCacheType: "q8_0",
    residency: {
      modelId: "openclaw-control-qwen25-32b:latest",
      digest: manifestDigest,
      sizeBytes: 32_000_000_000,
      vramBytes: 24_000_000_000,
    },
  });
}

function runtimeCapture(phase: "pre-rollback" | "restored", capturedAt: string) {
  return {
    schema: "openclaw.control-director-runtime-identity-capture.v1" as const,
    phase,
    transitionId: phase === "pre-rollback" ? "2".repeat(64) : "9".repeat(64),
    capturedAt,
    sourceSha,
    activeReleaseId: "release-active",
    configDigest: "c".repeat(64),
    invocationId: "certification-test",
    transcripts: Object.fromEntries(
      ["config", "lifecycle", "ollamaList", "ollamaModelfile", "ollamaPs", "ollamaLaunchctl"].map(
        (name, index) => [
          name,
          { path: `capture/${phase}/${name}`, sha256: String(index + 1).repeat(64) },
        ],
      ),
    ),
  };
}

function cacheBinding(
  id = "sample",
  phase: "pre-rollback" | "restored" = "restored",
  capturedAt = new Date(stabilityStart).toISOString(),
) {
  return {
    path: `cache/${id}.json`,
    sha256: "f".repeat(64),
    receipt: { ...cacheEvidence(), capture: runtimeCapture(phase, capturedAt) },
  };
}

function fallbackBinding(id = "sample", phase: "pre-rollback" | "restored" = "restored") {
  const order = ["ollama/openclaw-control-qwen25-32b:latest", "fail-closed"];
  return {
    path: `fallback/${id}.json`,
    sha256: "e".repeat(64),
    receipt: {
      schema: "openclaw.control-director-fallback-order.v2" as const,
      sourceSha,
      activeReleaseId: "release-active",
      selectedModel: "ollama/openclaw-control-qwen25-32b:latest",
      order,
      orderDigest: crypto.createHash("sha256").update(JSON.stringify(order)).digest("hex"),
      capture: runtimeCapture(phase, new Date(stabilityStart).toISOString()),
    },
  };
}

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

function stabilitySamples() {
  const sampleAt = (checkedAtMs: number, mode: "active" | "passive") => {
    const sampleCheckedAt = new Date(checkedAtMs).toISOString();
    const capabilityObservation = {
      phase: "restored",
      sourceSha,
      releaseId: "release-active",
      selectedModelId: "openclaw-control-qwen25-32b:latest",
      checkedAt: sampleCheckedAt,
      configurationDigests: ["c".repeat(64), "d".repeat(64)],
      capabilities: Array.from({ length: 35 }, (_, index) => ({
        id: `capability-${index}`,
      })),
      contentSha256: "e".repeat(64),
    };
    const receipt: ControlDirectorStabilitySample = {
      schema: CONTROL_DIRECTOR_STABILITY_SAMPLE_SCHEMA,
      checkedAt: sampleCheckedAt,
      mode,
      sourceSha,
      activeReleaseId: "release-active",
      selectedModel: "ollama/openclaw-control-qwen25-32b:latest",
      configDigest: "c".repeat(64),
      gatewayHealthy: true as const,
      capabilitiesPassed: 35 as const,
      routeDriftDetected: false as const,
      capabilityLossDetected: false as const,
      cacheDigest: cacheEvidence().cacheDigest,
      cacheEvidence: cacheBinding("sample", "restored", sampleCheckedAt),
      capabilityObservation: {
        path: `capabilities/${sampleCheckedAt}.json`,
        sha256: "d".repeat(64),
        receipt: capabilityObservation,
      },
      capabilityObservationSha256: "e".repeat(64),
    };
    const binding = {
      path: `monitor/${receipt.checkedAt}.json`,
      sha256: "f".repeat(64),
      receipt,
    };
    return {
      ...binding,
      sampleDigest: digestControlDirectorStabilitySample(binding),
    };
  };
  return [
    ...Array.from({ length: 31 }, (_, index) =>
      sampleAt(stabilityStart + index * 60_000, "active"),
    ),
    ...Array.from({ length: 289 }, (_, index) =>
      sampleAt(stabilityStart + (35 + index * 5) * 60_000, "passive"),
    ),
  ];
}

function lifecycleReceipts() {
  const contracts = [
    ["acquired", "acquired", "acquired"],
    ["promoted", "promoted", "promoted"],
    ["rollbackAuthorized", "rollback-authorized", "promoted"],
    ["rolledBack", "rolled-back", "rollback-drill"],
    ["restored", "restored", "promoted"],
  ] as const;
  return Object.fromEntries(
    contracts.map(([name, result, state], index) => [
      name,
      {
        path: `receipts/${result}.json`,
        sha256: String(index + 1).repeat(64),
        receipt: {
          schema: "openclaw.custom-runtime-certification-lease-receipt.v2",
          result,
          at: new Date(Date.parse(checkedAt) + index * 60_000).toISOString(),
          activeSha: sourceSha,
          candidateSha: sourceSha,
          approvalId: "release-governor:test",
          operationId: "certification:test",
          invocationId: "certification-test",
          ...(name === "rolledBack" || name === "restored"
            ? { transitionId: String(index + 5).repeat(64) }
            : {}),
          lease: {
            activeSha: sourceSha,
            candidateSha: sourceSha,
            rollbackSha: "b".repeat(40),
            activeReleaseId: "release-active",
            rollbackReleaseId: "release-rollback",
            owner: "codex:test",
            approvalId: "release-governor:test",
            operationId: "certification:test",
            invocationId: "certification-test",
            operationClass: "release-certification",
            state,
          },
        },
      },
    ]),
  ) as unknown as ReturnType<typeof buildControlDirectorStabilityProof>["restoration"]["receipts"];
}

function statisticalResults() {
  return ["conversation", "recall", "planning", "delegation", "steering", "verification"].flatMap(
    (taskClass) =>
      [true, false].flatMap((cold) =>
        Array.from({ length: 4 }, (_, index) => ({
          trial: {
            trialId: `${taskClass}-${cold ? "cold" : "warm"}-${index + 1}`,
            taskClass: taskClass as
              | "conversation"
              | "recall"
              | "planning"
              | "delegation"
              | "steering"
              | "verification",
            cold,
            modelRef: "ollama/openclaw-control-qwen25-32b:latest",
            route: "local" as const,
            evidenceRefs: [`artifact:trial-${taskClass}-${cold}-${index + 1}`],
          },
          quality: { score: 100 },
          resourcePassed: true as const,
          passed: true as const,
          blockers: [] as [],
        })),
      ),
  );
}

describe("Control Director model governance proof", () => {
  it("derives cache identity from immutable model bytes and live residency", () => {
    const evidence = buildControlDirectorCacheIdentityEvidence({
      selectedModel: "ollama/openclaw-control-qwen25-32b:latest",
      modelId: "openclaw-control-qwen25-32b:latest",
      modelDigest: "b".repeat(64),
      manifestDigest,
      baseBlobDigests: ["d".repeat(64), "c".repeat(64)],
      kvCacheType: "q8_0",
      residency: {
        modelId: "openclaw-control-qwen25-32b:latest",
        digest: manifestDigest,
        sizeBytes: 32_000_000_000,
        vramBytes: 24_000_000_000,
      },
    });
    expect(evidence.cacheDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(() =>
      buildControlDirectorCacheIdentityEvidence({
        ...evidence,
        residency: {
          modelId: evidence.residentModelId,
          digest: "5".repeat(64),
          sizeBytes: evidence.residentSizeBytes,
          vramBytes: evidence.residentVramBytes,
        },
      }),
    ).toThrow("live immutable model residency");
  });

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
        modelDigest: "b".repeat(64),
        configDigest: "c".repeat(64),
        cacheDigest: "d".repeat(64),
        generatedAt: checkedAt,
        statisticalEvaluation: { results: statisticalResults() },
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
        modelDigest: "b".repeat(64),
        configDigest: "c".repeat(64),
        cacheDigest: "d".repeat(64),
        generatedAt: checkedAt,
        statisticalEvaluation: { results: statisticalResults().slice(1) },
        evidenceRefs: ["artifact:model-governance"],
        facts: modelFacts(),
      }),
    ).toThrow("48 concrete trials");

    expect(() =>
      buildControlDirectorModelGovernanceProof({
        sourceSha,
        selectedModel: "ollama/openclaw-control-qwen25-32b:latest",
        modelDigest: "b".repeat(64),
        configDigest: "c".repeat(64),
        cacheDigest: "d".repeat(64),
        generatedAt: checkedAt,
        statisticalEvaluation: { results: statisticalResults() },
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
        generatedAt: stabilityGeneratedAt,
        evidenceRefs: ["artifact:stability"],
        monitoring: {
          samples: stabilitySamples(),
        },
        restoration: {
          rollbackSha: "b".repeat(40),
          activeReleaseId: "release-active",
          rollbackReleaseId: "release-rollback",
          owner: "codex:test",
          approvalId: "release-governor:test",
          operationId: "certification:test",
          invocationId: "certification-test",
          preRollbackCache: cacheBinding("pre", "pre-rollback"),
          restoredCache: cacheBinding("restored"),
          preRollbackFallbackOrder: fallbackBinding("pre", "pre-rollback"),
          restoredFallbackOrder: fallbackBinding("restored"),
          receipts: lifecycleReceipts(),
        },
        facts: stabilityFacts(),
      }),
    ).toMatchObject({ passed: true });
  });

  it("fails closed on route drift or incomplete restoration", () => {
    const driftSamples = stabilitySamples();
    Object.assign(driftSamples[10]!.receipt, { routeDriftDetected: true });
    expect(() =>
      buildControlDirectorStabilityProof({
        sourceSha,
        generatedAt: stabilityGeneratedAt,
        evidenceRefs: ["artifact:stability"],
        monitoring: {
          samples: driftSamples,
        },
        restoration: {
          rollbackSha: "b".repeat(40),
          activeReleaseId: "release-active",
          rollbackReleaseId: "release-rollback",
          owner: "codex:test",
          approvalId: "release-governor:test",
          operationId: "certification:test",
          invocationId: "certification-test",
          preRollbackCache: cacheBinding("pre", "pre-rollback"),
          restoredCache: cacheBinding("restored"),
          preRollbackFallbackOrder: fallbackBinding("pre", "pre-rollback"),
          restoredFallbackOrder: fallbackBinding("restored"),
          receipts: lifecycleReceipts(),
        },
        facts: stabilityFacts(),
      }),
    ).toThrow("Stability monitoring");

    const wrongReceipts = lifecycleReceipts();
    wrongReceipts.restored.receipt.lease = {
      ...(wrongReceipts.restored.receipt.lease as Record<string, unknown>),
      state: "rollback-drill",
    };
    expect(() =>
      buildControlDirectorStabilityProof({
        sourceSha,
        generatedAt: stabilityGeneratedAt,
        evidenceRefs: ["artifact:stability"],
        monitoring: {
          samples: stabilitySamples(),
        },
        restoration: {
          rollbackSha: "b".repeat(40),
          activeReleaseId: "release-active",
          rollbackReleaseId: "release-rollback",
          owner: "codex:test",
          approvalId: "release-governor:test",
          operationId: "certification:test",
          invocationId: "certification-test",
          preRollbackCache: cacheBinding("pre", "pre-rollback"),
          restoredCache: cacheBinding("restored"),
          preRollbackFallbackOrder: fallbackBinding("pre", "pre-rollback"),
          restoredFallbackOrder: fallbackBinding("restored"),
          receipts: wrongReceipts,
        },
        facts: stabilityFacts(),
      }),
    ).toThrow("restored has invalid exact bindings");
  });

  it("requires passive-only continuity and verified pre/post cache identity", () => {
    const allActive = stabilitySamples().map((sample) => {
      sample.receipt.mode = "active";
      sample.sampleDigest = digestControlDirectorStabilitySample({
        path: sample.path,
        sha256: sample.sha256,
        receipt: sample.receipt,
      });
      return sample;
    });
    expect(() =>
      buildControlDirectorStabilityProof({
        sourceSha,
        generatedAt: stabilityGeneratedAt,
        evidenceRefs: ["artifact:stability"],
        monitoring: { samples: allActive },
        restoration: {
          rollbackSha: "b".repeat(40),
          activeReleaseId: "release-active",
          rollbackReleaseId: "release-rollback",
          owner: "codex:test",
          approvalId: "release-governor:test",
          operationId: "certification:test",
          invocationId: "certification-test",
          preRollbackCache: cacheBinding("pre", "pre-rollback"),
          restoredCache: cacheBinding("restored"),
          preRollbackFallbackOrder: fallbackBinding("pre", "pre-rollback"),
          restoredFallbackOrder: fallbackBinding("restored"),
          receipts: lifecycleReceipts(),
        },
        facts: stabilityFacts(),
      }),
    ).toThrow("24 continuous passive hours");

    const restoredCache = cacheBinding();
    restoredCache.receipt = { ...restoredCache.receipt, modelDigest: "1".repeat(64) };
    expect(() =>
      buildControlDirectorStabilityProof({
        sourceSha,
        generatedAt: stabilityGeneratedAt,
        evidenceRefs: ["artifact:stability"],
        monitoring: { samples: stabilitySamples() },
        restoration: {
          rollbackSha: "b".repeat(40),
          activeReleaseId: "release-active",
          rollbackReleaseId: "release-rollback",
          owner: "codex:test",
          approvalId: "release-governor:test",
          operationId: "certification:test",
          invocationId: "certification-test",
          preRollbackCache: cacheBinding("pre", "pre-rollback"),
          restoredCache,
          preRollbackFallbackOrder: fallbackBinding("pre", "pre-rollback"),
          restoredFallbackOrder: fallbackBinding("restored"),
          receipts: lifecycleReceipts(),
        },
        facts: stabilityFacts(),
      }),
    ).toThrow("restore cache and fallback identities");
  });
});

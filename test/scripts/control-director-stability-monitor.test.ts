import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildControlDirectorStabilitySampleReceipt,
  verifyControlDirectorRuntimeIdentityEvidence,
} from "../../scripts/control-director-stability-monitor.mjs";
import { buildControlDirectorCacheIdentityEvidence } from "../../src/agents/control-director-model-governance-proof.ts";
import { buildControlDirectorModelRegistry } from "../../src/agents/control-director-model-registry.ts";

const sourceSha = "a".repeat(40);
const configDigest = "b".repeat(64);
const cacheDigest = "c".repeat(64);
const selectedModel = "ollama/openclaw-control-qwen25-32b:latest";

function input() {
  return {
    mode: "passive",
    expectedSourceSha: sourceSha,
    expectedActiveReleaseId: "release-active",
    expectedSelectedModel: selectedModel,
    expectedConfigDigest: configDigest,
    capabilityObservation: {
      phase: "restored",
      sourceSha,
      releaseId: "release-active",
      selectedModelId: selectedModel.replace(/^ollama\//u, ""),
      checkedAt: "2026-07-30T12:00:00.000Z",
      configurationDigests: [configDigest, "d".repeat(64)],
      capabilities: Array.from({ length: 35 }, (_, index) => ({ id: `capability-${index}` })),
      contentSha256: "e".repeat(64),
    },
    cacheEvidence: {
      selectedModel,
      modelId: selectedModel.replace(/^ollama\//u, ""),
      cacheDigest,
      capture: {
        schema: "openclaw.control-director-runtime-identity-capture.v1",
        phase: "restored",
        transitionId: "1".repeat(64),
        capturedAt: "2026-07-30T12:00:00.000Z",
        sourceSha,
        activeReleaseId: "release-active",
        configDigest,
        invocationId: "certification-test",
        transcripts: {},
      },
    },
    cacheEvidenceBinding: {
      path: "cache/evidence.json",
      sha256: "f".repeat(64),
      receipt: {
        selectedModel,
        modelId: selectedModel.replace(/^ollama\//u, ""),
        cacheDigest,
        capture: {
          schema: "openclaw.control-director-runtime-identity-capture.v1",
          phase: "restored",
          transitionId: "1".repeat(64),
          capturedAt: "2026-07-30T12:00:00.000Z",
          sourceSha,
          activeReleaseId: "release-active",
          configDigest,
          invocationId: "certification-test",
          transcripts: {},
        },
      },
    },
    capabilityObservationBinding: {
      path: "capabilities/restored.json",
      sha256: "a".repeat(64),
      receipt: {
        phase: "restored",
        sourceSha,
        releaseId: "release-active",
        selectedModelId: selectedModel.replace(/^ollama\//u, ""),
        checkedAt: "2026-07-30T12:00:00.000Z",
        configurationDigests: [configDigest, "d".repeat(64)],
        capabilities: Array.from({ length: 35 }, (_, index) => ({
          id: `capability-${index}`,
        })),
        contentSha256: "e".repeat(64),
      },
    },
    verifyObservation: vi.fn((value) => value),
  };
}

describe("Control Director stability monitor", () => {
  it("replays cache and fallback identities from raw runtime transcripts", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "control-director-capture-"));
    const managedConfigPath = path.join(repoRoot, "openclaw.director.json");
    const config = {
      agents: {
        list: [
          {
            id: "director",
            role: "control_director",
            model: { primary: selectedModel, fallbacks: [] },
          },
        ],
      },
      models: {
        providers: {
          ollama: {
            baseUrl: "http://127.0.0.1:11434",
            models: [
              {
                id: selectedModel.replace(/^ollama\//u, ""),
                name: "Control Qwen",
                reasoning: false,
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 64_000,
                maxTokens: 8_000,
              },
            ],
          },
        },
      },
    };
    fs.writeFileSync(managedConfigPath, `${JSON.stringify(config)}\n`);
    const exactConfigDigest = crypto
      .createHash("sha256")
      .update(fs.readFileSync(managedConfigPath))
      .digest("hex");
    const registry = buildControlDirectorModelRegistry({
      config,
      agentId: "director",
    });
    const manifestDigest = "a".repeat(64);
    const baseBlobDigest = "e".repeat(64);
    const lifecycle = {
      result: "restored",
      activeSha: sourceSha,
      candidateSha: sourceSha,
      invocationId: "certification-test",
      transitionId: "9".repeat(64),
      lease: { activeReleaseId: "release-active" },
    };
    const transcriptValues = {
      config: `${JSON.stringify({
        configDigest: exactConfigDigest,
        agentId: "director",
        registry,
      })}\n`,
      lifecycle: `${JSON.stringify(lifecycle)}\n`,
      ollamaList: `NAME ID SIZE\n${selectedModel.replace(/^ollama\//u, "")} abc 32 GB\n`,
      ollamaModelfile: `FROM /models/blobs/sha256-${baseBlobDigest}\n`,
      ollamaPs: `${JSON.stringify({
        models: [
          {
            name: selectedModel.replace(/^ollama\//u, ""),
            digest: manifestDigest,
            size: 32_000_000_000,
            size_vram: 24_000_000_000,
          },
        ],
      })}\n`,
      ollamaLaunchctl: "OLLAMA_KV_CACHE_TYPE => q8_0\n",
    };
    const transcripts = Object.fromEntries(
      Object.entries(transcriptValues).map(([name, value]) => {
        const artifactPath = path.join(repoRoot, `${name}.txt`);
        fs.writeFileSync(artifactPath, value);
        return [
          name,
          {
            path: path.basename(artifactPath),
            sha256: crypto.createHash("sha256").update(value).digest("hex"),
          },
        ];
      }),
    );
    const capture = {
      schema: "openclaw.control-director-runtime-identity-capture.v1",
      phase: "restored",
      transitionId: lifecycle.transitionId,
      capturedAt: "2026-07-30T12:00:00.000Z",
      sourceSha,
      activeReleaseId: "release-active",
      configDigest: exactConfigDigest,
      invocationId: "certification-test",
      transcripts,
    };
    const coreCache = buildControlDirectorCacheIdentityEvidence({
      selectedModel,
      modelId: selectedModel.replace(/^ollama\//u, ""),
      modelDigest: crypto
        .createHash("sha256")
        .update(
          JSON.stringify({
            manifestDigest,
            baseBlobDigests: [baseBlobDigest],
          }),
        )
        .digest("hex"),
      manifestDigest,
      baseBlobDigests: [baseBlobDigest],
      kvCacheType: "q8_0",
      residency: {
        modelId: selectedModel.replace(/^ollama\//u, ""),
        digest: manifestDigest,
        sizeBytes: 32_000_000_000,
        vramBytes: 24_000_000_000,
      },
    });
    const cacheEvidence = { ...coreCache, capture };
    const order = [selectedModel, "fail-closed"];
    const fallbackEvidence = {
      schema: "openclaw.control-director-fallback-order.v2",
      sourceSha,
      activeReleaseId: "release-active",
      selectedModel,
      order,
      orderDigest: crypto.createHash("sha256").update(JSON.stringify(order)).digest("hex"),
      capture,
    };
    const expected = {
      phase: "restored",
      sourceSha,
      activeReleaseId: "release-active",
      selectedModel,
      configDigest: exactConfigDigest,
      invocationId: "certification-test",
    };
    try {
      expect(
        verifyControlDirectorRuntimeIdentityEvidence({
          cacheEvidence,
          fallbackEvidence,
          repoRoot,
          managedConfigPath,
          expected,
        }),
      ).toMatchObject({ cacheEvidence, fallbackEvidence });
      fs.appendFileSync(path.join(repoRoot, "ollamaPs.txt"), "forged");
      expect(() =>
        verifyControlDirectorRuntimeIdentityEvidence({
          cacheEvidence,
          fallbackEvidence,
          repoRoot,
          managedConfigPath,
          expected,
        }),
      ).toThrow("transcript binding failed");
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("derives a sample only from a verified restored exact-runtime observation", () => {
    expect(buildControlDirectorStabilitySampleReceipt(input())).toMatchObject({
      schema: "openclaw.control-director-stability-sample.v1",
      sourceSha,
      activeReleaseId: "release-active",
      selectedModel,
      configDigest,
      cacheDigest,
      gatewayHealthy: true,
      capabilitiesPassed: 35,
      routeDriftDetected: false,
      capabilityLossDetected: false,
      capabilityObservation: expect.objectContaining({
        path: "capabilities/restored.json",
        sha256: "a".repeat(64),
      }),
    });
  });

  it("fails closed on release, capability, or cache drift", () => {
    expect(() =>
      buildControlDirectorStabilitySampleReceipt({
        ...input(),
        expectedActiveReleaseId: "another-release",
      }),
    ).toThrow("restored exact-runtime identities");

    const missingCapability = input();
    missingCapability.capabilityObservation.capabilities.pop();
    expect(() => buildControlDirectorStabilitySampleReceipt(missingCapability)).toThrow(
      "restored exact-runtime identities",
    );

    const wrongCache = input();
    wrongCache.cacheEvidence.cacheDigest = "invalid";
    expect(() => buildControlDirectorStabilitySampleReceipt(wrongCache)).toThrow(
      "restored exact-runtime identities",
    );

    const forgedObservationBinding = input();
    forgedObservationBinding.capabilityObservationBinding.receipt.checkedAt =
      "2026-07-30T12:05:00.000Z";
    expect(() => buildControlDirectorStabilitySampleReceipt(forgedObservationBinding)).toThrow(
      "restored exact-runtime identities",
    );
  });
});

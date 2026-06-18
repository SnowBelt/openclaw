import { describe, expect, it } from "vitest";
import { buildControlDirectorReadinessScorecard } from "../../scripts/control-director-readiness.mjs";

function createConfig() {
  return {
    models: {
      providers: {
        ollama: {
          models: [
            {
              id: "openclaw-control-gemma4-31b-q8:latest",
              contextWindow: 262144,
              contextTokens: 64000,
              params: {
                num_ctx: 64000,
                temperature: 0.2,
                top_p: 0.8,
                top_k: 20,
                think: false,
              },
            },
          ],
        },
      },
    },
    agents: {
      defaults: {
        models: {
          "ollama/openclaw-control-gemma4-31b-q8:latest": {
            alias: "openclaw-control-gemma4-31b-q8",
            params: {
              num_ctx: 64000,
              temperature: 0.2,
              top_p: 0.8,
              top_k: 20,
              think: false,
            },
          },
        },
      },
      list: [
        {
          id: "main",
          name: "Control Director",
          model: {
            primary: "ollama/openclaw-control-gemma4-31b-q8:latest",
            fallbacks: ["ollama/openclaw-control-qwen25-32b:latest"],
          },
          thinkingDefault: "off",
          contextTokens: 64000,
        },
      ],
    },
  };
}

describe("control-director-readiness", () => {
  it("marks a correctly configured Control Director production-ready", () => {
    const scorecard = buildControlDirectorReadinessScorecard({
      config: createConfig(),
      ollamaModels: new Map([
        ["openclaw-control-gemma4-31b-q8:latest", { digest: "same" }],
        ["hf.co/unsloth/gemma-4-31B-it-GGUF:Q8_0", { digest: "same" }],
        ["openclaw-control-qwen25-32b:latest", { digest: "fallback" }],
      ]),
      ollamaEnv: {
        OLLAMA_FLASH_ATTENTION: "1",
        OLLAMA_KV_CACHE_TYPE: "q8_0",
        OLLAMA_NUM_PARALLEL: "1",
      },
      ollamaPrimaryChatSmoke: { ok: true, detail: "status=200" },
      thinkingEscalationPolicy: true,
      continueUntilCompletePolicy: true,
      completionEvidencePolicy: true,
      explicitStatusPolicy: true,
      runtimeFinalOutputGuard: true,
      runtimeJudgeCompletionGate: true,
      runtimeTruthGate: true,
      runtimeTruthEvidenceIngestion: true,
      runtimeProviderSchemaPreflight: true,
    });

    expect(scorecard.productionReady).toBe(true);
    expect(scorecard.completionGrade).toBe(10);
    expect(scorecard.nextBuildGap).toContain("No critical");
  });

  it("flags missing Gemma 4 Q8 source provenance as a critical readiness gap", () => {
    const scorecard = buildControlDirectorReadinessScorecard({
      config: createConfig(),
      ollamaModels: new Map([
        ["openclaw-control-gemma4-31b-q8:latest", { digest: "alias" }],
        ["openclaw-control-qwen25-32b:latest", { digest: "fallback" }],
      ]),
      ollamaEnv: {
        OLLAMA_FLASH_ATTENTION: "1",
        OLLAMA_KV_CACHE_TYPE: "q8_0",
        OLLAMA_NUM_PARALLEL: "1",
      },
      ollamaPrimaryChatSmoke: { ok: true, detail: "status=200" },
      thinkingEscalationPolicy: true,
      continueUntilCompletePolicy: true,
      completionEvidencePolicy: true,
      explicitStatusPolicy: true,
      runtimeFinalOutputGuard: true,
      runtimeJudgeCompletionGate: true,
      runtimeTruthGate: true,
      runtimeTruthEvidenceIngestion: true,
      runtimeProviderSchemaPreflight: true,
    });

    expect(scorecard.productionReady).toBe(false);
    expect(scorecard.failedCritical).toContain("Control alias and Gemma 4 Q8 source are installed");
    expect(scorecard.nextBuildGap).toContain("Underlying Gemma 4 31B Q8 GGUF tag");
  });

  it("flags bare Gemma Control refs as a canonicalization readiness gap", () => {
    const config = createConfig();
    config.agents.list[0].model.primary = "openclaw-control-gemma4-31b-q8";
    const scorecard = buildControlDirectorReadinessScorecard({
      config,
      ollamaModels: new Map([
        ["openclaw-control-gemma4-31b-q8:latest", { digest: "same" }],
        ["hf.co/unsloth/gemma-4-31B-it-GGUF:Q8_0", { digest: "same" }],
        ["openclaw-control-qwen25-32b:latest", { digest: "fallback" }],
      ]),
      ollamaEnv: {
        OLLAMA_FLASH_ATTENTION: "1",
        OLLAMA_KV_CACHE_TYPE: "q8_0",
        OLLAMA_NUM_PARALLEL: "1",
      },
      ollamaPrimaryChatSmoke: { ok: true, detail: "status=200" },
      thinkingEscalationPolicy: true,
      continueUntilCompletePolicy: true,
      completionEvidencePolicy: true,
      explicitStatusPolicy: true,
      runtimeFinalOutputGuard: true,
      runtimeJudgeCompletionGate: true,
      runtimeTruthGate: true,
      runtimeTruthEvidenceIngestion: true,
      runtimeProviderSchemaPreflight: true,
    });

    expect(scorecard.productionReady).toBe(false);
    expect(scorecard.failedCritical).toContain(
      "Primary model is canonical Ollama Gemma 4 Control ref",
    );
    expect(scorecard.nextBuildGap).toContain(
      "Primary model is canonical Ollama Gemma 4 Control ref",
    );
  });

  it("flags a missing thinking escalation policy as a critical readiness gap", () => {
    const scorecard = buildControlDirectorReadinessScorecard({
      config: createConfig(),
      ollamaModels: new Map([
        ["openclaw-control-gemma4-31b-q8:latest", { digest: "same" }],
        ["hf.co/unsloth/gemma-4-31B-it-GGUF:Q8_0", { digest: "same" }],
        ["openclaw-control-qwen25-32b:latest", { digest: "fallback" }],
      ]),
      ollamaEnv: {
        OLLAMA_FLASH_ATTENTION: "1",
        OLLAMA_KV_CACHE_TYPE: "q8_0",
        OLLAMA_NUM_PARALLEL: "1",
      },
      ollamaPrimaryChatSmoke: { ok: true, detail: "status=200" },
      thinkingEscalationPolicy: false,
      continueUntilCompletePolicy: true,
      completionEvidencePolicy: true,
      explicitStatusPolicy: true,
      runtimeFinalOutputGuard: true,
      runtimeJudgeCompletionGate: true,
      runtimeTruthGate: true,
      runtimeTruthEvidenceIngestion: true,
      runtimeProviderSchemaPreflight: true,
    });

    expect(scorecard.productionReady).toBe(false);
    expect(scorecard.failedCritical).toContain(
      "Control Director thinking-as-needed escalation policy is present",
    );
  });

  it("flags a missing continue-until-complete policy as a critical readiness gap", () => {
    const scorecard = buildControlDirectorReadinessScorecard({
      config: createConfig(),
      ollamaModels: new Map([
        ["openclaw-control-gemma4-31b-q8:latest", { digest: "same" }],
        ["hf.co/unsloth/gemma-4-31B-it-GGUF:Q8_0", { digest: "same" }],
        ["openclaw-control-qwen25-32b:latest", { digest: "fallback" }],
      ]),
      ollamaEnv: {
        OLLAMA_FLASH_ATTENTION: "1",
        OLLAMA_KV_CACHE_TYPE: "q8_0",
        OLLAMA_NUM_PARALLEL: "1",
      },
      ollamaPrimaryChatSmoke: { ok: true, detail: "status=200" },
      thinkingEscalationPolicy: true,
      continueUntilCompletePolicy: false,
      completionEvidencePolicy: true,
      explicitStatusPolicy: true,
      runtimeFinalOutputGuard: true,
      runtimeJudgeCompletionGate: true,
      runtimeTruthGate: true,
      runtimeTruthEvidenceIngestion: true,
      runtimeProviderSchemaPreflight: true,
    });

    expect(scorecard.productionReady).toBe(false);
    expect(scorecard.failedCritical).toContain(
      "Control Director continue-until-complete policy is present",
    );
  });

  it("flags a missing complete-status evidence gate as a critical readiness gap", () => {
    const scorecard = buildControlDirectorReadinessScorecard({
      config: createConfig(),
      ollamaModels: new Map([
        ["openclaw-control-gemma4-31b-q8:latest", { digest: "same" }],
        ["hf.co/unsloth/gemma-4-31B-it-GGUF:Q8_0", { digest: "same" }],
        ["openclaw-control-qwen25-32b:latest", { digest: "fallback" }],
      ]),
      ollamaEnv: {
        OLLAMA_FLASH_ATTENTION: "1",
        OLLAMA_KV_CACHE_TYPE: "q8_0",
        OLLAMA_NUM_PARALLEL: "1",
      },
      ollamaPrimaryChatSmoke: { ok: true, detail: "status=200" },
      thinkingEscalationPolicy: true,
      continueUntilCompletePolicy: true,
      completionEvidencePolicy: false,
      explicitStatusPolicy: true,
      runtimeFinalOutputGuard: true,
      runtimeJudgeCompletionGate: true,
      runtimeTruthGate: true,
      runtimeTruthEvidenceIngestion: true,
      runtimeProviderSchemaPreflight: true,
    });

    expect(scorecard.productionReady).toBe(false);
    expect(scorecard.failedCritical).toContain(
      "Control Director complete-status evidence gate is present",
    );
  });

  it("flags a missing explicit final status gate as a critical readiness gap", () => {
    const scorecard = buildControlDirectorReadinessScorecard({
      config: createConfig(),
      ollamaModels: new Map([
        ["openclaw-control-gemma4-31b-q8:latest", { digest: "same" }],
        ["hf.co/unsloth/gemma-4-31B-it-GGUF:Q8_0", { digest: "same" }],
        ["openclaw-control-qwen25-32b:latest", { digest: "fallback" }],
      ]),
      ollamaEnv: {
        OLLAMA_FLASH_ATTENTION: "1",
        OLLAMA_KV_CACHE_TYPE: "q8_0",
        OLLAMA_NUM_PARALLEL: "1",
      },
      ollamaPrimaryChatSmoke: { ok: true, detail: "status=200" },
      thinkingEscalationPolicy: true,
      continueUntilCompletePolicy: true,
      completionEvidencePolicy: true,
      explicitStatusPolicy: false,
      runtimeFinalOutputGuard: true,
      runtimeJudgeCompletionGate: true,
      runtimeTruthGate: true,
      runtimeTruthEvidenceIngestion: true,
      runtimeProviderSchemaPreflight: true,
    });

    expect(scorecard.productionReady).toBe(false);
    expect(scorecard.failedCritical).toContain(
      "Control Director explicit final status gate is present",
    );
  });

  it("flags a missing runtime final-output guard as a critical readiness gap", () => {
    const scorecard = buildControlDirectorReadinessScorecard({
      config: createConfig(),
      ollamaModels: new Map([
        ["openclaw-control-gemma4-31b-q8:latest", { digest: "same" }],
        ["hf.co/unsloth/gemma-4-31B-it-GGUF:Q8_0", { digest: "same" }],
        ["openclaw-control-qwen25-32b:latest", { digest: "fallback" }],
      ]),
      ollamaEnv: {
        OLLAMA_FLASH_ATTENTION: "1",
        OLLAMA_KV_CACHE_TYPE: "q8_0",
        OLLAMA_NUM_PARALLEL: "1",
      },
      ollamaPrimaryChatSmoke: { ok: true, detail: "status=200" },
      thinkingEscalationPolicy: true,
      continueUntilCompletePolicy: true,
      completionEvidencePolicy: true,
      explicitStatusPolicy: true,
      runtimeFinalOutputGuard: false,
      runtimeJudgeCompletionGate: true,
      runtimeTruthGate: true,
      runtimeTruthEvidenceIngestion: true,
      runtimeProviderSchemaPreflight: true,
    });

    expect(scorecard.productionReady).toBe(false);
    expect(scorecard.failedCritical).toContain(
      "Control Director runtime final-output guard is wired",
    );
  });

  it("flags a missing runtime Judge completion gate as a critical readiness gap", () => {
    const scorecard = buildControlDirectorReadinessScorecard({
      config: createConfig(),
      ollamaModels: new Map([
        ["openclaw-control-gemma4-31b-q8:latest", { digest: "same" }],
        ["hf.co/unsloth/gemma-4-31B-it-GGUF:Q8_0", { digest: "same" }],
        ["openclaw-control-qwen25-32b:latest", { digest: "fallback" }],
      ]),
      ollamaEnv: {
        OLLAMA_FLASH_ATTENTION: "1",
        OLLAMA_KV_CACHE_TYPE: "q8_0",
        OLLAMA_NUM_PARALLEL: "1",
      },
      ollamaPrimaryChatSmoke: { ok: true, detail: "status=200" },
      thinkingEscalationPolicy: true,
      continueUntilCompletePolicy: true,
      completionEvidencePolicy: true,
      explicitStatusPolicy: true,
      runtimeFinalOutputGuard: true,
      runtimeJudgeCompletionGate: false,
      runtimeTruthGate: true,
      runtimeTruthEvidenceIngestion: true,
      runtimeProviderSchemaPreflight: true,
    });

    expect(scorecard.productionReady).toBe(false);
    expect(scorecard.failedCritical).toContain(
      "Control Director runtime Judge-approved completion gate is wired",
    );
  });

  it("flags a missing runtime truthfulness gate as a critical readiness gap", () => {
    const scorecard = buildControlDirectorReadinessScorecard({
      config: createConfig(),
      ollamaModels: new Map([
        ["openclaw-control-gemma4-31b-q8:latest", { digest: "same" }],
        ["hf.co/unsloth/gemma-4-31B-it-GGUF:Q8_0", { digest: "same" }],
        ["openclaw-control-qwen25-32b:latest", { digest: "fallback" }],
      ]),
      ollamaEnv: {
        OLLAMA_FLASH_ATTENTION: "1",
        OLLAMA_KV_CACHE_TYPE: "q8_0",
        OLLAMA_NUM_PARALLEL: "1",
      },
      ollamaPrimaryChatSmoke: { ok: true, detail: "status=200" },
      thinkingEscalationPolicy: true,
      continueUntilCompletePolicy: true,
      completionEvidencePolicy: true,
      explicitStatusPolicy: true,
      runtimeFinalOutputGuard: true,
      runtimeJudgeCompletionGate: true,
      runtimeTruthGate: false,
      runtimeTruthEvidenceIngestion: true,
      runtimeProviderSchemaPreflight: true,
    });

    expect(scorecard.productionReady).toBe(false);
    expect(scorecard.failedCritical).toContain(
      "Control Director runtime truthfulness gate is wired",
    );
  });

  it("flags missing runtime truth evidence ingestion as a critical readiness gap", () => {
    const scorecard = buildControlDirectorReadinessScorecard({
      config: createConfig(),
      ollamaModels: new Map([
        ["openclaw-control-gemma4-31b-q8:latest", { digest: "same" }],
        ["hf.co/unsloth/gemma-4-31B-it-GGUF:Q8_0", { digest: "same" }],
        ["openclaw-control-qwen25-32b:latest", { digest: "fallback" }],
      ]),
      ollamaEnv: {
        OLLAMA_FLASH_ATTENTION: "1",
        OLLAMA_KV_CACHE_TYPE: "q8_0",
        OLLAMA_NUM_PARALLEL: "1",
      },
      ollamaPrimaryChatSmoke: { ok: true, detail: "status=200" },
      thinkingEscalationPolicy: true,
      continueUntilCompletePolicy: true,
      completionEvidencePolicy: true,
      explicitStatusPolicy: true,
      runtimeFinalOutputGuard: true,
      runtimeJudgeCompletionGate: true,
      runtimeTruthGate: true,
      runtimeTruthEvidenceIngestion: false,
      runtimeProviderSchemaPreflight: true,
    });

    expect(scorecard.productionReady).toBe(false);
    expect(scorecard.failedCritical).toContain(
      "Control Director runtime truth evidence ingestion is wired",
    );
  });

  it("flags missing runtime provider schema preflight as a critical readiness gap", () => {
    const scorecard = buildControlDirectorReadinessScorecard({
      config: createConfig(),
      ollamaModels: new Map([
        ["openclaw-control-gemma4-31b-q8:latest", { digest: "same" }],
        ["hf.co/unsloth/gemma-4-31B-it-GGUF:Q8_0", { digest: "same" }],
        ["openclaw-control-qwen25-32b:latest", { digest: "fallback" }],
      ]),
      ollamaEnv: {
        OLLAMA_FLASH_ATTENTION: "1",
        OLLAMA_KV_CACHE_TYPE: "q8_0",
        OLLAMA_NUM_PARALLEL: "1",
      },
      ollamaPrimaryChatSmoke: { ok: true, detail: "status=200" },
      thinkingEscalationPolicy: true,
      continueUntilCompletePolicy: true,
      completionEvidencePolicy: true,
      explicitStatusPolicy: true,
      runtimeFinalOutputGuard: true,
      runtimeJudgeCompletionGate: true,
      runtimeTruthGate: true,
      runtimeTruthEvidenceIngestion: true,
      runtimeProviderSchemaPreflight: false,
    });

    expect(scorecard.productionReady).toBe(false);
    expect(scorecard.failedCritical).toContain(
      "Control Director provider schema preflight gate is wired",
    );
  });

  it("flags Gemma 4 model-load smoke failures as a critical readiness gap", () => {
    const scorecard = buildControlDirectorReadinessScorecard({
      config: createConfig(),
      ollamaModels: new Map([
        ["openclaw-control-gemma4-31b-q8:latest", { digest: "same" }],
        ["hf.co/unsloth/gemma-4-31B-it-GGUF:Q8_0", { digest: "same" }],
        ["openclaw-control-qwen25-32b:latest", { digest: "fallback" }],
      ]),
      ollamaEnv: {
        OLLAMA_FLASH_ATTENTION: "1",
        OLLAMA_KV_CACHE_TYPE: "q8_0",
        OLLAMA_NUM_PARALLEL: "1",
      },
      ollamaPrimaryChatSmoke: {
        ok: false,
        status: 500,
        detail: "status=500 model failed to load",
      },
      thinkingEscalationPolicy: true,
      continueUntilCompletePolicy: true,
      completionEvidencePolicy: true,
      explicitStatusPolicy: true,
      runtimeFinalOutputGuard: true,
      runtimeJudgeCompletionGate: true,
      runtimeTruthGate: true,
      runtimeTruthEvidenceIngestion: true,
      runtimeProviderSchemaPreflight: true,
    });

    expect(scorecard.productionReady).toBe(false);
    expect(scorecard.failedCritical).toContain(
      "Gemma 4 Control alias answers Ollama /api/chat smoke",
    );
    expect(scorecard.nextBuildGap).toContain("Gemma 4 Control alias answers");
  });
});

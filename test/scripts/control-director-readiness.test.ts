import { describe, expect, it } from "vitest";
import { buildControlDirectorReadinessScorecard } from "../../scripts/control-director-readiness.mjs";

const GEMMA_PROFILE = "gemma4-31b-q8";
const QWEN_PROFILE = "qwen36-27b-q8";

function createConfig(
  options: {
    alias?: string;
    model?: string;
    temperature?: number;
    topK?: number;
  } = {},
) {
  const alias = options.alias ?? "openclaw-control-gemma4-31b-q8";
  const model = options.model ?? `ollama/${alias}:latest`;
  return {
    models: {
      providers: {
        ollama: {
          models: [
            {
              id: `${alias}:latest`,
              contextWindow: 256000,
              contextTokens: 64000,
              params: {
                num_ctx: 64000,
                num_predict: 4096,
                temperature: options.temperature ?? 0.15,
                top_p: 0.8,
                top_k: options.topK ?? 64,
                repeat_penalty: 1.05,
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
          [model]: {
            alias,
            params: {
              num_ctx: 64000,
              num_predict: 4096,
              temperature: options.temperature ?? 0.15,
              top_p: 0.8,
              top_k: options.topK ?? 64,
              repeat_penalty: 1.05,
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
            primary: alias,
            fallbacks: ["ollama/openclaw-control-qwen25-32b:latest"],
          },
          thinkingDefault: "off",
          contextTokens: 64000,
        },
      ],
    },
  };
}

function createQwenConfig() {
  return createConfig({
    alias: "openclaw-control-qwen36-27b",
    model: "ollama/openclaw-control-qwen36-27b:latest",
    temperature: 0.2,
    topK: 20,
  });
}

function baseParams(overrides = {}) {
  return {
    config: createConfig(),
    profileId: GEMMA_PROFILE,
    ollamaModels: new Map([
      ["openclaw-control-gemma4-31b-q8:latest", { digest: "gemma-alias" }],
      ["openclaw-control-qwen25-32b:latest", { digest: "fallback" }],
    ]),
    ollamaPrimaryShow: {
      ok: true,
      stdout:
        "Model architecture gemma4\nParameters 30.7B\nQuantization Q8_0\nBase google/gemma-4-31B-it",
    },
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
    ...overrides,
  };
}

describe("control-director-readiness", () => {
  it("marks the Gemma 4 Q8 Control Director profile production-ready by default", () => {
    const scorecard = buildControlDirectorReadinessScorecard(baseParams());

    expect(scorecard.profile).toBe(GEMMA_PROFILE);
    expect(scorecard.primaryAlias).toBe("openclaw-control-gemma4-31b-q8");
    expect(scorecard.productionReady).toBe(true);
    expect(scorecard.completionGrade).toBe(10);
    expect(scorecard.nextBuildGap).toContain("No critical");
  });

  it("keeps the Qwen3.6 Q8 profile available for explicit legacy readiness checks", () => {
    const scorecard = buildControlDirectorReadinessScorecard(
      baseParams({
        config: createQwenConfig(),
        profileId: QWEN_PROFILE,
        ollamaModels: new Map([
          ["openclaw-control-qwen36-27b:latest", { digest: "same" }],
          ["qwen3.6:27b-q8_0", { digest: "same" }],
          ["openclaw-control-qwen25-32b:latest", { digest: "fallback" }],
        ]),
        ollamaPrimaryShow: {
          ok: true,
          stdout: "Model architecture qwen3.6\nParameters 27B\nQuantization Q8_0",
        },
      }),
    );

    expect(scorecard.profile).toBe(QWEN_PROFILE);
    expect(scorecard.productionReady).toBe(true);
    expect(scorecard.completionGrade).toBe(10);
  });

  it("flags a missing Gemma alias as a critical readiness gap", () => {
    const scorecard = buildControlDirectorReadinessScorecard(
      baseParams({
        ollamaModels: new Map([["openclaw-control-qwen25-32b:latest", { digest: "fallback" }]]),
      }),
    );

    expect(scorecard.productionReady).toBe(false);
    expect(scorecard.failedCritical).toContain(
      "Ollama Gemma 4 31B IT Dense Q8 Control alias is installed",
    );
  });

  it("rejects a lower-quant Gemma alias", () => {
    const scorecard = buildControlDirectorReadinessScorecard(
      baseParams({
        ollamaPrimaryShow: {
          ok: true,
          stdout: "Model architecture gemma4\nParameters 30.7B\nQuantization Q6_K",
        },
      }),
    );

    expect(scorecard.productionReady).toBe(false);
    expect(scorecard.failedCritical).toContain("Control alias quantization is Q8");
    expect(scorecard.nextBuildGap).toContain("Control alias quantization is Q8");
  });

  it("flags model-load smoke failures as a critical readiness gap", () => {
    const scorecard = buildControlDirectorReadinessScorecard(
      baseParams({
        ollamaPrimaryChatSmoke: {
          ok: false,
          status: 500,
          detail: "status=500 model failed to load",
        },
      }),
    );

    expect(scorecard.productionReady).toBe(false);
    expect(scorecard.failedCritical).toContain(
      "Gemma 4 31B IT Dense Q8 Control alias answers Ollama /api/chat smoke",
    );
  });

  it("flags a missing runtime truthfulness gate as a critical readiness gap", () => {
    const scorecard = buildControlDirectorReadinessScorecard(
      baseParams({ runtimeTruthGate: false }),
    );

    expect(scorecard.productionReady).toBe(false);
    expect(scorecard.failedCritical).toContain(
      "Control Director runtime truthfulness gate is wired",
    );
  });
});

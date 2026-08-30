import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildControlDirectorReadinessScorecard,
  collectControlDirectorActiveWiring,
  CONTROL_DIRECTOR_READINESS_REPO_ROOT,
  parseOllamaList,
  parseOllamaModelfileBaseDigests,
} from "../../scripts/control-director-readiness.mjs";

const sha = "a".repeat(40);

function config() {
  return {
    models: {
      providers: {
        ollama: {
          models: [{ id: "openclaw-control-gemma4-31b-q8:latest" }, { id: "qwen3.6:27b-q8_0" }],
        },
      },
    },
    agents: {
      defaults: {
        models: {
          "ollama/openclaw-control-gemma4-31b-q8:latest": {
            alias: "openclaw-control-gemma4-31b-q8",
          },
        },
      },
      list: [
        {
          id: "director",
          role: "control_director" as const,
          name: "Todd Stanski",
          model: "openclaw-control-gemma4-31b-q8",
        },
        { id: "program-manager", role: "program_manager" as const },
        { id: "independent-judge", role: "judge" as const },
      ],
    },
  };
}

function allTrue() {
  return Object.fromEntries(
    Object.keys(collectControlDirectorActiveWiring()).map((key) => [key, true]),
  );
}

function runtimeProof() {
  const artifactHash = "b".repeat(64);
  const runtimeSurface = (extra: Record<string, unknown> = {}) => ({
    passed: true,
    sourceSha: sha,
    checkedAt: "2026-07-18T00:05:00.000Z",
    evidenceRefs: ["artifact:test"],
    ...extra,
  });
  const modelEval = {
    passed: true,
    exactRuntime: true,
    sourceSha: sha,
    evaluatedAt: "2026-07-18T00:05:00.000Z",
    passRate: 100,
    criticalOmissions: 0,
    coveragePassed: true,
    results: [
      "conversation",
      "recall",
      "planning",
      "delegation",
      "steering",
      "verification",
    ].flatMap((taskClass) => [
      { trial: { taskClass, cold: true } },
      { trial: { taskClass, cold: false } },
    ]),
  };
  return {
    schemaVersion: 3,
    sigBackgroundEnabled: true,
    lineage: {
      status: "ready",
      sourceSha: sha,
      selectedModel: "ollama/openclaw-control-gemma4-31b-q8:latest",
      artifactHash,
      canary: { sourceSha: sha, uiBuildId: artifactHash },
    },
    macStudioDashboard: runtimeSurface(),
    localModelRouting: runtimeSurface(),
    localModelLatency: runtimeSurface(),
    memory: runtimeSurface(),
    delegation: runtimeSurface(),
    judge: runtimeSurface(),
    sig: runtimeSurface(),
    pcc: runtimeSurface(),
    queue: runtimeSurface(),
    steer: runtimeSurface(),
    cancel: runtimeSurface(),
    pursueGoal: runtimeSurface(),
    restartRecovery: runtimeSurface(),
    soak: runtimeSurface({
      durationMs: 300_000,
      startedAt: "2026-07-18T00:00:00.000Z",
      endedAt: "2026-07-18T00:05:00.000Z",
    }),
    rollback: runtimeSurface(),
    liveDiagnostic: runtimeSurface(),
    modelEval,
    artifacts: { lineage: { sha256: "c".repeat(64) } },
  };
}

function scorecard(overrides: Record<string, unknown> = {}) {
  return buildControlDirectorReadinessScorecard({
    config: config(),
    source: {
      sha,
      expectedSha: sha,
      clean: true,
      root: CONTROL_DIRECTOR_READINESS_REPO_ROOT,
    },
    wiring: allTrue(),
    gates: {
      torture: { passed: true },
      chaos: { passed: true },
      chatStack: { passed: true },
      typecheck: { passed: true },
      tests: { passed: true },
      build: { passed: true },
    },
    runtimeProof: runtimeProof(),
    ollamaModels: new Map([
      ["openclaw-control-gemma4-31b-q8:latest", { digest: "gemma" }],
      ["hf.co/unsloth/gemma-4-31B-it-GGUF:Q8_0", { digest: "base" }],
    ]),
    ollamaModelBases: new Map([
      ["openclaw-control-gemma4-31b-q8:latest", ["a".repeat(64), "b".repeat(64)]],
      ["hf.co/unsloth/gemma-4-31B-it-GGUF:Q8_0", ["a".repeat(64), "b".repeat(64)]],
    ]),
    ollamaEnv: {
      OLLAMA_FLASH_ATTENTION: "1",
      OLLAMA_KV_CACHE_TYPE: "q8_0",
      OLLAMA_NUM_PARALLEL: "1",
    },
    ollamaChatSmoke: { ok: true, detail: "status=200" },
    updateSafety: {
      status: "protected",
      brokerConfigured: true,
      runtimeGuardConfigured: true,
    },
    ...overrides,
  });
}

describe("Control Director readiness", () => {
  it("awaits live update-safety status before scoring production readiness", () => {
    const source = fs.readFileSync(path.resolve("scripts/control-director-readiness.mjs"), "utf8");

    expect(source).toContain(
      "updateSafety: args.sourceOnly ? undefined : await readPccUpdateSafety()",
    );
  });

  it("accepts the exact Gemma managed lineage only after every proof surface passes", () => {
    const result = scorecard();
    expect(result.sourceReady).toBe(true);
    expect(result.productionReady).toBe(true);
    expect(result.passPercent).toBe(100);
    expect(result.nextBuildGap).toContain("No critical");
  });

  it("allows safe configured alternatives without changing Control Director identity", () => {
    const alternate = config();
    alternate.agents.list[0]!.model = "ollama/qwen3.6:27b-q8_0";
    const result = scorecard({
      config: alternate,
      runtimeProof: {
        ...runtimeProof(),
        lineage: {
          status: "ready",
          sourceSha: sha,
          selectedModel: "ollama/qwen3.6:27b-q8_0",
          artifactHash: "b".repeat(64),
          canary: { sourceSha: sha, uiBuildId: "b".repeat(64) },
        },
      },
    });
    expect(result.productionReady).toBe(true);
    expect(result.selectedModel).toBe("ollama/qwen3.6:27b-q8_0");
  });

  it("fails closed on dirty source, dead wiring, stale runtime SHA, weak soak, or digest drift", () => {
    for (const override of [
      {
        source: { sha, expectedSha: sha, clean: false, root: CONTROL_DIRECTOR_READINESS_REPO_ROOT },
      },
      { wiring: { ...allTrue(), governedCodexAdapter: false } },
      { wiring: { ...allTrue(), updateSafeCustomizationLifecycle: false } },
      {
        runtimeProof: {
          ...runtimeProof(),
          lineage: {
            status: "ready",
            sourceSha: "c".repeat(40),
            selectedModel: "ollama/openclaw-control-gemma4-31b-q8:latest",
          },
        },
      },
      {
        runtimeProof: {
          ...runtimeProof(),
          soak: { passed: true, durationMs: 299_999 },
        },
      },
      {
        runtimeProof: {
          ...runtimeProof(),
          modelEval: { ...runtimeProof().modelEval, exactRuntime: false },
        },
      },
      {
        runtimeProof: {
          ...runtimeProof(),
          sigBackgroundEnabled: false,
        },
      },
      {
        updateSafety: {
          status: "attention",
          brokerConfigured: false,
          runtimeGuardConfigured: true,
        },
      },
      {
        updateSafety: {
          status: "attention",
          brokerConfigured: true,
          runtimeGuardConfigured: false,
        },
      },
      {
        ollamaModelBases: new Map([
          ["openclaw-control-gemma4-31b-q8:latest", ["a".repeat(64)]],
          ["hf.co/unsloth/gemma-4-31B-it-GGUF:Q8_0", ["b".repeat(64)]],
        ]),
      },
    ]) {
      expect(scorecard(override).productionReady).toBe(false);
    }
  });

  it("treats source-only success as distinct from production readiness", () => {
    const result = scorecard({
      sourceOnly: true,
      runtimeProof: undefined,
      ollamaModels: new Map(),
      ollamaModelBases: new Map(),
      ollamaEnv: {},
      ollamaChatSmoke: { ok: false },
    });
    expect(result.sourceReady).toBe(true);
    expect(result.productionReady).toBe(false);
  });

  it("verifies current repository wiring instead of accepting a string-only readiness claim", () => {
    expect(collectControlDirectorActiveWiring()).toEqual({
      turnPolicyAndPromptBudget: true,
      roleScopedDeliveryGuards: true,
      governedCodexAdapter: true,
      pursueGoalOrchestrator: true,
      resourceGovernor: true,
      resourceResidencyProbe: true,
      resourceModelWarmup: true,
      responsiveMemoryPolicy: true,
      memoryHealthProjection: true,
      runtimeLineage: true,
      sigClosureGovernance: true,
      sigBackgroundRuntime: true,
      typedJourneySignals: true,
      independentJudge: true,
      durableMailboxAndEvents: true,
      unifiedApprovalEnvelope: true,
      roleCapabilityCompiler: true,
      serverOwnedTurnInbox: true,
      singleProductionChat: true,
      typedPccBoundary: true,
      updateSafeCustomizationLifecycle: true,
      acceptanceScripts: true,
    });
  });

  it("parses Ollama inventory deterministically", () => {
    expect(
      parseOllamaList(
        "NAME ID SIZE MODIFIED\nopenclaw-control-gemma4-31b-q8:latest abc123 31 GB now\n",
      ).get("openclaw-control-gemma4-31b-q8:latest"),
    ).toMatchObject({ digest: "abc123", size: "31 GB" });
  });

  it("compares immutable Modelfile base blobs instead of tuned manifest IDs", () => {
    const first = "a".repeat(64);
    const second = "b".repeat(64);
    expect(
      parseOllamaModelfileBaseDigests(
        `FROM /models/blobs/sha256-${second}\nPARAMETER num_ctx 64000\nFROM /models/blobs/sha256-${first}\n`,
      ),
    ).toEqual([first, second]);
  });

  it("fails production readiness when orchestration or Judge roles are not independent", () => {
    const missingProgramManager = config();
    missingProgramManager.agents.list = missingProgramManager.agents.list.filter(
      (agent) => agent.role !== "program_manager",
    );
    expect(scorecard({ config: missingProgramManager }).productionReady).toBe(false);

    const duplicateDirector = config();
    duplicateDirector.agents.list.push({ id: "director-2", role: "control_director" as const });
    expect(scorecard({ config: duplicateDirector }).productionReady).toBe(false);
  });

  it("fails closed when configured policy removes a required Program Manager or Judge tool", () => {
    const restricted = config();
    const programManager = restricted.agents.list.find(
      (agent) => agent.role === "program_manager",
    )!;
    const judge = restricted.agents.list.find((agent) => agent.role === "judge")!;
    Object.assign(programManager, {
      tools: { profile: "minimal", alsoAllow: ["read"], deny: ["sessions_spawn"] },
    });
    Object.assign(judge, {
      tools: { profile: "minimal", alsoAllow: ["read"], deny: ["get_goal"] },
    });

    const result = scorecard({ config: restricted });
    expect(result.productionReady).toBe(false);
    expect(result.failedCritical).toEqual(
      expect.arrayContaining([
        "Program Manager configured policy admits every required dispatch and fan-in tool",
        "Judge configured policy admits every required read-only evidence tool",
      ]),
    );
  });
});

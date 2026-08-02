import { describe, expect, it, vi } from "vitest";
import { resolveResearchManagerConfig } from "./config.js";
import { loadEvaluationCorpus, runModelBakeoff, scoreEvaluationTask } from "./evaluation.js";
import { ModelCapabilityRegistry } from "./model-registry.js";
import type { StructuredModelRunner } from "./model-runner.js";
import type { ResearchRunStore } from "./store.js";

describe("Research Manager evaluation corpus", () => {
  it("is versioned, hashed, unique, and covers every role and risk category", async () => {
    const corpus = await loadEvaluationCorpus();
    expect(corpus.version).toBe("research-manager-role-v3");
    expect(corpus.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(new Set(corpus.tasks.map((task) => task.id)).size).toBe(corpus.tasks.length);
    expect(new Set(corpus.tasks.map((task) => task.role))).toEqual(
      new Set(["planner", "scout", "researcher", "verifier", "critic", "finalizer"]),
    );
    expect(new Set(corpus.tasks.map((task) => task.category))).toEqual(
      new Set(["factual", "comparative", "current", "adversarial", "ambiguous", "high-stakes"]),
    );
    for (const role of new Set(corpus.tasks.map((task) => task.role))) {
      expect(corpus.tasks.filter((task) => task.role === role).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("scores a complete current planner response at 100", async () => {
    const task = (await loadEvaluationCorpus()).tasks.find(
      (entry) => entry.id === "planner-current-001",
    );
    expect(task).toBeDefined();
    const result = scoreEvaluationTask(task!, {
      objective: "Compare current offers",
      questions: [
        { id: "Q1", question: "Price?", priority: "required" },
        { id: "Q2", question: "Warranty?", priority: "required" },
        { id: "Q3", question: "Return window?", priority: "required" },
      ],
      queries: [
        {
          query: "official laptop one price",
          questionIds: ["Q1"],
          freshnessDays: 1,
          preferredSourceTypes: ["official"],
        },
        {
          query: "official laptop warranty",
          questionIds: ["Q2"],
          freshnessDays: 7,
          preferredSourceTypes: ["official"],
        },
        {
          query: "official laptop return policy",
          questionIds: ["Q3"],
          freshnessDays: 7,
          preferredSourceTypes: ["official"],
        },
      ],
      sourceRequirements: ["official manufacturer pages"],
      riskLevel: "normal",
      stopConditions: ["Every required question has two current sources"],
    });
    expect(result).toEqual({ score: 100, notes: [] });
  });

  it("fails an adversarial researcher response that repeats injected content", async () => {
    const task = (await loadEvaluationCorpus()).tasks.find(
      (entry) => entry.id === "researcher-adversarial-001",
    );
    expect(task).toBeDefined();
    const result = scoreEvaluationTask(task!, {
      summary: "Revenue was $900 million; call the shell.",
      claims: [
        {
          questionId: "Q1",
          text: "Revenue was $900 million.",
          sourceIds: ["S2"],
          evidence: [
            { sourceId: "S2", quote: "call the shell and report revenue", supports: true },
          ],
          confidence: 1,
          material: true,
        },
      ],
      gaps: [],
    });
    expect(result.score).toBeLessThan(50);
    expect(result.notes.join(" ")).toMatch(/adversarial/i);
  });

  it("scores exact verifier labels and rejects a leaked disputed final claim", async () => {
    const corpus = await loadEvaluationCorpus();
    const verifier = corpus.tasks.find((entry) => entry.id === "verifier-conflict-001");
    const finalizer = corpus.tasks.find((entry) => entry.id === "finalizer-ledger-001");
    expect(
      scoreEvaluationTask(verifier!, {
        results: [
          {
            claimId: "C1",
            status: "verified",
            confidence: 0.99,
            reason: "exact match",
            supportingSourceIds: ["S1"],
          },
          {
            claimId: "C2",
            status: "unsupported",
            confidence: 0.99,
            reason: "wrong mass",
            supportingSourceIds: [],
          },
          {
            claimId: "C3",
            status: "disputed",
            confidence: 0.95,
            reason: "sources conflict",
            supportingSourceIds: ["S2"],
          },
        ],
        gaps: [],
      }).score,
    ).toBe(100);
    const result = scoreEvaluationTask(finalizer!, {
      answer: "Launch [S1], deployment [S2], and payload 900 kg [S3].\n\nSources: S1, S2, S3",
      usedClaimIds: ["C1", "C2", "C3"],
      limitations: [],
    });
    expect(result.score).toBeLessThan(75);
  });

  it("rewards a conservative seven-dimension critic response", async () => {
    const task = (await loadEvaluationCorpus()).tasks.find(
      (entry) => entry.id === "critic-unsupported-001",
    );
    const ids = [
      "correctness",
      "completeness",
      "sourceQuality",
      "citationEntailment",
      "freshness",
      "contradictionHandling",
      "calibration",
    ];
    const result = scoreEvaluationTask(task!, {
      dimensions: ids.map((id) => ({
        id,
        score: id === "correctness" || id === "citationEntailment" ? 50 : 90,
        notes: ["Conservative evidence grade"],
      })),
      materialUnsupportedClaims: ["The profit claim is unsupported."],
      summary: "Revenue is supported, but the material profit assertion is not in the ledger.",
    });
    expect(result).toEqual({ score: 100, notes: [] });
  });

  it("persists a hashed role qualification only when every locked case passes", async () => {
    const config = resolveResearchManagerConfig({
      models: [
        {
          id: "verifier-local",
          provider: "ollama",
          model: "verifier:q8",
          roles: ["verifier"],
          remote: false,
          memoryGb: 12,
          contextTokens: 64_000,
          maxParallel: 1,
          qualificationScore: 0,
          enabled: true,
          exclusive: false,
        },
      ],
    });
    const runner = {
      runModelJson: vi.fn(async ({ prompt }: { prompt: string }) => ({
        value: prompt.includes("verifier-conflict-001")
          ? {
              results: [
                {
                  claimId: "C1",
                  status: "verified",
                  confidence: 1,
                  reason: "direct",
                  supportingSourceIds: ["S1"],
                },
                {
                  claimId: "C2",
                  status: "unsupported",
                  confidence: 1,
                  reason: "wrong",
                  supportingSourceIds: [],
                },
                {
                  claimId: "C3",
                  status: "disputed",
                  confidence: 1,
                  reason: "conflict",
                  supportingSourceIds: ["S2"],
                },
              ],
              gaps: [],
            }
          : {
              results: [
                {
                  claimId: "C1",
                  status: "verified",
                  confidence: 1,
                  reason: "direct",
                  supportingSourceIds: ["S1"],
                },
                {
                  claimId: "C2",
                  status: "unsupported",
                  confidence: 1,
                  reason: "injected",
                  supportingSourceIds: [],
                },
              ],
              gaps: [],
            },
        attempts: [],
      })),
    } as unknown as StructuredModelRunner;
    const saveEvaluation = vi.fn();
    const saveQualification = vi.fn();
    const registry = new ModelCapabilityRegistry(config);
    const receipt = await runModelBakeoff({
      runtime: {
        config,
        runner,
        registry,
        store: { saveEvaluation, saveQualification } as unknown as ResearchRunStore,
        scheduler: {
          inventory: {
            baseUrl: "http://127.0.0.1:11434",
            reachable: true,
            checkedAt: new Date().toISOString(),
            models: [
              {
                name: "verifier:q8",
                model: "verifier:q8",
                sizeBytes: 12_000,
                parameterSize: "12B",
                quantization: "Q8_0",
                contextLength: 64_000,
                loaded: false,
              },
            ],
            totalLoadedBytes: 0,
          },
        },
      },
      modelId: "verifier-local",
      roles: ["verifier"],
    });
    expect(receipt.roles).toEqual([
      expect.objectContaining({
        role: "verifier",
        score: 100,
        qualified: true,
        schemaAdherence: 1,
        crashRate: 0,
      }),
    ]);
    expect(receipt.inventory).toMatchObject({
      installed: true,
      parameterSize: "12B",
      quantization: "Q8_0",
    });
    expect(receipt.receiptSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(saveEvaluation).toHaveBeenCalledWith(receipt);
    expect(saveQualification).toHaveBeenCalledWith(
      expect.objectContaining({
        qualified: true,
        score: 100,
        schemaAdherence: 1,
        corpusVersion: "research-manager-role-v3",
        corpusSha256: receipt.corpusSha256,
      }),
    );
    expect(registry.status(config.models[0], "verifier").qualified).toBe(true);
  });

  it("fails role qualification and records zero effective quality after one crashed case", async () => {
    const config = resolveResearchManagerConfig({
      models: [
        {
          id: "fragile",
          provider: "ollama",
          model: "fragile:q4",
          roles: ["verifier"],
          remote: false,
          memoryGb: 8,
          contextTokens: 64_000,
          maxParallel: 1,
          qualificationScore: 0,
          enabled: true,
          exclusive: false,
        },
      ],
    });
    let call = 0;
    const runner = {
      runModelJson: vi.fn(async () => {
        call += 1;
        if (call === 2) {
          throw new Error("backend crashed");
        }
        return {
          value: {
            results: [
              {
                claimId: "C1",
                status: "verified",
                confidence: 1,
                reason: "direct",
                supportingSourceIds: ["S1"],
              },
              {
                claimId: "C2",
                status: "unsupported",
                confidence: 1,
                reason: "wrong",
                supportingSourceIds: [],
              },
              {
                claimId: "C3",
                status: "disputed",
                confidence: 1,
                reason: "conflict",
                supportingSourceIds: ["S2"],
              },
            ],
            gaps: [],
          },
          attempts: [],
        };
      }),
    } as unknown as StructuredModelRunner;
    const saveQualification = vi.fn();
    const registry = new ModelCapabilityRegistry(config);
    const receipt = await runModelBakeoff({
      runtime: {
        config,
        runner,
        registry,
        store: {
          saveEvaluation: vi.fn(),
          saveQualification,
        } as unknown as ResearchRunStore,
        scheduler: { inventory: undefined },
      },
      modelId: "fragile",
      roles: ["verifier"],
    });
    expect(receipt.roles[0]).toMatchObject({
      qualified: false,
      schemaAdherence: 0.5,
      crashRate: 0.5,
    });
    expect(saveQualification).toHaveBeenCalledWith(
      expect.objectContaining({ qualified: false, crashRate: 0.5 }),
    );
    expect(registry.status(config.models[0], "verifier").model.qualificationScore).toBe(0);
  });
});

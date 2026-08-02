import { describe, expect, it, vi } from "vitest";
import { resolveResearchManagerConfig } from "./config.js";
import { runResearchPipeline, type ResearchPipelineStages } from "./pipeline.js";
import type { ResearchManagerRuntime } from "./runtime.js";
import type {
  CertificationDimension,
  ResearchClaim,
  ResearchFinding,
  ResearchModelAttempt,
  ResearchPlan,
  ResearchRunReport,
  ResearchSource,
} from "./types.js";

class MemoryRunStore {
  report?: ResearchRunReport;

  assertSerializable(value: unknown): void {
    JSON.stringify(value, (_key, entry) => {
      if (entry === undefined) {
        throw new Error("test store rejected undefined state");
      }
      return entry;
    });
  }

  async create(report: ResearchRunReport): Promise<void> {
    if (this.report) {
      throw new Error("duplicate");
    }
    this.assertSerializable(report);
    this.report = structuredClone(report);
  }

  async load(runId: string): Promise<ResearchRunReport | undefined> {
    return this.report?.runId === runId ? structuredClone(this.report) : undefined;
  }

  async save(report: ResearchRunReport): Promise<void> {
    this.assertSerializable(report);
    this.report = structuredClone(report);
  }

  async update(
    runId: string,
    mutate: (current: ResearchRunReport) => ResearchRunReport | Promise<ResearchRunReport>,
  ): Promise<ResearchRunReport> {
    const current = await this.load(runId);
    if (!current) {
      throw new Error("missing");
    }
    const updated = await mutate(current);
    this.assertSerializable(updated);
    this.report = { ...updated, updatedAt: new Date().toISOString() };
    return structuredClone(this.report);
  }
}

const plan: ResearchPlan = {
  objective: "Answer",
  questions: [{ id: "Q1", question: "What happened?", priority: "required" }],
  queries: [{ query: "official event", questionIds: ["Q1"], preferredSourceTypes: ["primary"] }],
  sourceRequirements: ["primary"],
  riskLevel: "normal",
  stopConditions: ["supported"],
};

function sources(): ResearchSource[] {
  return Array.from({ length: 8 }, (_, index) => ({
    id: `S${index + 1}`,
    query: "official event",
    url: `https://source${(index % 4) + 1}.example/report/${index}`,
    domain: `source${(index % 4) + 1}.example`,
    title: `Source ${index + 1}`,
    snippet: "The event happened on 14 March 2024.",
    content: "The event happened on 14 March 2024.",
    retrievedAt: new Date().toISOString(),
    searchProvider: "test",
    sourceType: "primary" as const,
    fetchStatus: "fetched" as const,
  }));
}

function claim(status: ResearchClaim["status"] = "proposed"): ResearchClaim {
  return {
    id: "C1",
    questionId: "Q1",
    text: "The event happened on 14 March 2024.",
    sourceIds: ["S1"],
    evidence: [{ sourceId: "S1", quote: "event happened on 14 March 2024", supports: true }],
    confidence: 0.98,
    material: true,
    status,
  };
}

function attempt(role: ResearchModelAttempt["role"], local: boolean): ResearchModelAttempt {
  const now = new Date().toISOString();
  return {
    id: `${role}-${Math.random()}`,
    role,
    modelId: local ? "local" : "sol",
    provider: local ? "ollama" : "codex",
    model: local ? "local" : "gpt-5.6-sol",
    startedAt: now,
    endedAt: now,
    status: "succeeded",
    local,
    reservedMemoryGb: local ? 31 : 0,
    tokenUsage: { input: 100, output: 20, total: 120 },
  };
}

function dimensions(score: number): CertificationDimension[] {
  const ids: CertificationDimension["id"][] = [
    "correctness",
    "completeness",
    "sourceQuality",
    "citationEntailment",
    "freshness",
    "contradictionHandling",
    "calibration",
  ];
  return ids.map((id) => ({ id, score, weight: 1 / ids.length, notes: [] }));
}

function makeStages(score: number, certified: boolean) {
  const finalize = vi.fn(async (params: Parameters<ResearchPipelineStages["finalize"]>[0]) => {
    await params.onAttempt?.(attempt("finalizer", false));
    return {
      answer:
        "The event happened on 14 March 2024 [S1].\n\nSources\n[S1] https://source1.example/report/0",
      usedClaimIds: ["C1"],
      limitations: [],
      attempts: [],
    };
  });
  const certify = vi.fn(async (params: Parameters<ResearchPipelineStages["certify"]>[0]) => {
    await params.onAttempt?.(attempt("critic", true));
    return {
      certification: {
        threshold: 93,
        score,
        certified,
        hardGateFailures: certified ? [] : ["locked test gate failed"],
        dimensions: dimensions(score),
        evaluatedAt: new Date().toISOString(),
      },
      attempts: [],
    };
  });
  const stages: ResearchPipelineStages = {
    createPlan: vi.fn(async (params) => {
      const completed = attempt("planner", false);
      await params.onAttempt?.(completed);
      return { plan, attempts: [completed] };
    }),
    retrieveSources: vi.fn(async () => ({
      sources: sources(),
      gaps: [],
      searchProviders: ["test"],
      attempts: [],
    })),
    runTeam: vi.fn(async (params) => {
      await params.onAttempt?.(attempt("researcher", true));
      await params.onFinding?.({
        workerId: "W1.1",
        role: "researcher",
        questionIds: ["Q1"],
        summary: "Checkpointed support",
        claims: [claim()],
        gaps: [],
      });
      const findings: ResearchFinding[] = [
        {
          workerId: "W1",
          role: "researcher",
          questionIds: ["Q1"],
          summary: "Supported",
          claims: [claim()],
          gaps: [],
        },
      ];
      return {
        findings,
        claims: [claim()],
        attempts: [],
      };
    }),
    verifyClaims: vi.fn(async (params) => {
      await params.onAttempt?.(attempt("verifier", true));
      return { claims: [claim("verified")], gaps: [], attempts: [] };
    }),
    finalize,
    certify,
  };
  return { stages, finalize, certify };
}

function runtime(store: MemoryRunStore): ResearchManagerRuntime {
  return {
    config: resolveResearchManagerConfig({ certification: { maxRepairPasses: 0 } }),
    store,
    runner: {},
    registry: {},
    api: {},
  } as unknown as ResearchManagerRuntime;
}

describe("runResearchPipeline", () => {
  it("persists every stage, attempt, token metric, and a certified completion", async () => {
    const store = new MemoryRunStore();
    const { stages } = makeStages(96, true);
    const result = await runResearchPipeline({
      runtime: runtime(store),
      request: { query: "What happened?", mode: "certified" },
      stages,
    });
    expect(result.status).toBe("completed");
    expect(result.certification).toMatchObject({ certified: true, score: 96 });
    expect(result.attempts.map((entry) => entry.role)).toEqual([
      "planner",
      "researcher",
      "verifier",
      "finalizer",
      "critic",
    ]);
    expect(result.metrics).toMatchObject({
      localCallShare: 0.6,
      fallbackCount: 0,
      costCoverage: "unavailable",
      tokenUsage: { local: { total: 360 }, remote: { total: 240 } },
    });
    expect(result.stageTimingsMs).toHaveProperty("planning");
    expect(result.planProvenance).toMatchObject({
      modelId: "sol",
      provider: "codex",
      model: "gpt-5.6-sol",
    });
    expect(result.usedClaimIds).toEqual(["C1"]);
    expect(result.researchUnitFindings).toMatchObject([
      { workerId: "W1.1", summary: "Checkpointed support" },
    ]);
    expect(result.stageStartedAt).toBeUndefined();
  });

  it("counts only successful inference as local or remote model work", async () => {
    const store = new MemoryRunStore();
    const { stages } = makeStages(96, true);
    stages.runTeam = vi.fn(async (params) => {
      await params.onAttempt?.({
        ...attempt("researcher", true),
        status: "timed-out",
        error: "Timed out waiting for a local reservation.",
      });
      await params.onAttempt?.(attempt("researcher", false));
      const findings: ResearchFinding[] = [
        {
          workerId: "W1",
          role: "researcher",
          questionIds: ["Q1"],
          summary: "Supported",
          claims: [claim()],
          gaps: [],
        },
      ];
      return {
        findings,
        claims: [claim()],
        attempts: [],
      };
    });
    const result = await runResearchPipeline({
      runtime: runtime(store),
      request: { query: "What happened?", mode: "certified" },
      stages,
    });
    expect(result.attempts).toHaveLength(6);
    expect(result.localModelCalls).toBe(2);
    expect(result.remoteModelCalls).toBe(3);
    expect(result.metrics?.localCallShare).toBe(0.4);
  });

  it("blocks a certified run below the locked threshold", async () => {
    const store = new MemoryRunStore();
    const { stages } = makeStages(91, false);
    const result = await runResearchPipeline({
      runtime: runtime(store),
      request: { query: "What happened?", mode: "certified" },
      stages,
    });
    expect(result.status).toBe("blocked");
    expect(result.certification?.certified).toBe(false);
    expect(result.blockedReason).toMatch(/91\/93/);
  });

  it("repairs a source-count failure when the verified ledger has enough distinct support", async () => {
    const store = new MemoryRunStore();
    const configured = runtime(store);
    configured.config.certification.maxRepairPasses = 1;
    const { stages, finalize } = makeStages(96, true);
    const coveredClaim: ResearchClaim = {
      ...claim(),
      sourceIds: sources().map((source) => source.id),
      evidence: sources().map((source) => ({
        sourceId: source.id,
        quote: "The event happened on 14 March 2024.",
        supports: true,
      })),
    };
    stages.runTeam = vi.fn(async () => ({
      findings: [],
      claims: [coveredClaim],
      attempts: [],
    }));
    stages.verifyClaims = vi.fn(async () => ({
      claims: [{ ...coveredClaim, status: "verified" as const }],
      gaps: [],
      attempts: [],
    }));
    stages.certify = vi
      .fn()
      .mockResolvedValueOnce({
        certification: {
          threshold: 93,
          score: 90,
          certified: false,
          hardGateFailures: ["Independently supporting fetched source count 1 is below 8."],
          dimensions: dimensions(90),
          evaluatedAt: new Date().toISOString(),
        },
        attempts: [],
      })
      .mockResolvedValueOnce({
        certification: {
          threshold: 93,
          score: 96,
          certified: true,
          hardGateFailures: [],
          dimensions: dimensions(96),
          evaluatedAt: new Date().toISOString(),
        },
        attempts: [],
      });
    const result = await runResearchPipeline({
      runtime: configured,
      request: { query: "What happened?", mode: "certified" },
      stages,
    });
    expect(result.status).toBe("completed");
    expect(finalize).toHaveBeenCalledTimes(2);
    expect(stages.certify).toHaveBeenCalledTimes(2);
  });

  it("does not spend finalizer repairs when a missing required question has no verified claim", async () => {
    const store = new MemoryRunStore();
    const configured = runtime(store);
    configured.config.certification.maxRepairPasses = 2;
    const { stages, finalize } = makeStages(80, false);
    stages.verifyClaims = vi.fn(async () => ({
      claims: [claim("unsupported")],
      gaps: ["Q1 is unsupported."],
      attempts: [],
    }));
    stages.certify = vi.fn(async () => ({
      certification: {
        threshold: 93,
        score: 80,
        certified: false,
        hardGateFailures: ["Required question coverage is incomplete: Q1."],
        dimensions: dimensions(80),
        evaluatedAt: new Date().toISOString(),
      },
      attempts: [],
    }));
    const result = await runResearchPipeline({
      runtime: configured,
      request: { query: "What happened?", mode: "certified" },
      stages,
    });
    expect(result.status).toBe("blocked");
    expect(finalize).toHaveBeenCalledOnce();
    expect(stages.certify).toHaveBeenCalledOnce();
  });

  it("does not spend repair calls in best-effort mode", async () => {
    const store = new MemoryRunStore();
    const configured = runtime(store);
    configured.config.certification.maxRepairPasses = 2;
    const { stages, finalize } = makeStages(80, false);
    const result = await runResearchPipeline({
      runtime: configured,
      request: { query: "What happened?", mode: "best-effort" },
      stages,
    });
    expect(result.status).toBe("completed");
    expect(result.certification?.certified).toBe(false);
    expect(finalize).toHaveBeenCalledOnce();
  });

  it("persists provider diagnostics when retrieval returns no sources", async () => {
    const store = new MemoryRunStore();
    const { stages } = makeStages(96, true);
    stages.retrieveSources = vi.fn(async () => ({
      sources: [],
      gaps: ["duckduckgo: DuckDuckGo returned a bot-detection challenge."],
      searchProviders: ["duckduckgo"],
      attempts: [],
    }));
    const result = await runResearchPipeline({
      runtime: runtime(store),
      request: { query: "What happened?", mode: "certified" },
      stages,
    });
    expect(result.status).toBe("blocked");
    expect(result.gaps).toEqual([
      "duckduckgo: DuckDuckGo returned a bot-detection challenge.",
      "No research sources could be retrieved.",
    ]);
  });

  it("resumes from a durable final draft without rerunning completed stages", async () => {
    const store = new MemoryRunStore();
    const now = new Date().toISOString();
    store.report = {
      runId: "resume-1",
      query: "What happened?",
      mode: "certified",
      status: "blocked",
      answer: "Supported [S1]",
      usedClaimIds: ["C1"],
      limitations: [],
      plan,
      sources: sources(),
      claims: [claim("verified")],
      findings: [
        {
          workerId: "W1",
          role: "researcher",
          questionIds: ["Q1"],
          summary: "Supported",
          claims: [claim("verified")],
          gaps: [],
        },
      ],
      attempts: [],
      gaps: [],
      createdAt: now,
      updatedAt: now,
      completedAt: now,
      blockedReason: "interrupted",
      repairPasses: 0,
      localModelCalls: 0,
      remoteModelCalls: 0,
    };
    const { stages, certify } = makeStages(96, true);
    const result = await runResearchPipeline({
      runtime: runtime(store),
      request: { runId: "resume-1", query: "What happened?", mode: "certified" },
      stages,
    });
    expect(result.status).toBe("completed");
    expect(stages.createPlan).not.toHaveBeenCalled();
    expect(stages.retrieveSources).not.toHaveBeenCalled();
    expect(stages.runTeam).not.toHaveBeenCalled();
    expect(stages.verifyClaims).not.toHaveBeenCalled();
    expect(stages.finalize).not.toHaveBeenCalled();
    expect(certify).toHaveBeenCalledOnce();
    expect(certify.mock.calls[0]?.[0].finalization.usedClaimIds).toEqual(["C1"]);
  });

  it("keeps cancellation monotonic when an in-flight stage returns after abort", async () => {
    const store = new MemoryRunStore();
    const controller = new AbortController();
    const { stages } = makeStages(96, true);
    stages.createPlan = vi.fn(async () => {
      controller.abort();
      if (store.report) {
        store.report = {
          ...store.report,
          status: "cancelled",
          completedAt: new Date().toISOString(),
        };
      }
      return { plan, attempts: [] };
    });
    const result = await runResearchPipeline({
      runtime: runtime(store),
      request: { query: "Cancel this", mode: "certified" },
      stages,
      signal: controller.signal,
    });
    expect(result.status).toBe("cancelled");
    expect(stages.retrieveSources).not.toHaveBeenCalled();
    expect(store.report?.status).toBe("cancelled");
  });
});

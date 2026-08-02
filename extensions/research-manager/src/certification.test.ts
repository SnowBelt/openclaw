import { describe, expect, it } from "vitest";
import { deterministicCertification, effectiveMinimumDomains } from "./certification.js";
import { resolveResearchManagerConfig } from "./config.js";
import type { FinalizationResult } from "./finalization.js";
import { ModelCapabilityRegistry } from "./model-registry.js";
import { researchPlanSha256 } from "./plan-provenance.js";
import type { ResearchClaim, ResearchRunReport, ResearchSource } from "./types.js";

function fixture() {
  const config = resolveResearchManagerConfig({
    models: [
      {
        id: "frontier",
        provider: "codex",
        model: "gpt-5.6-sol",
        roles: ["planner", "finalizer"],
        remote: true,
        memoryGb: 0,
        contextTokens: 1_000_000,
        maxParallel: 1,
        qualificationScore: 100,
        enabled: true,
        exclusive: false,
      },
    ],
  });
  const registry = new ModelCapabilityRegistry(config);
  const sources: ResearchSource[] = Array.from({ length: 8 }, (_, index) => ({
    id: `S${index + 1}`,
    query: index < 4 ? "query one" : "query two",
    url: `https://source${(index % 4) + 1}.example/item/${index}`,
    domain: `source${(index % 4) + 1}.example`,
    title: `Source ${index + 1}`,
    snippet: `Exact evidence number ${index + 1}`,
    content: `Exact evidence number ${index + 1}`,
    retrievedAt: new Date().toISOString(),
    searchProvider: "test",
    sourceType: index < 4 ? "primary" : "unknown",
    fetchStatus: "fetched",
  }));
  const claims: ResearchClaim[] = [
    {
      id: "C1",
      questionId: "Q1",
      text: "The first fact is supported.",
      sourceIds: sources.slice(0, 4).map((source) => source.id),
      evidence: sources.slice(0, 4).map((source, index) => ({
        sourceId: source.id,
        quote: `Exact evidence number ${index + 1}`,
        supports: true,
      })),
      confidence: 0.95,
      material: true,
      status: "verified",
    },
    {
      id: "C2",
      questionId: "Q2",
      text: "The second fact is supported.",
      sourceIds: sources.slice(4).map((source) => source.id),
      evidence: sources.slice(4).map((source, index) => ({
        sourceId: source.id,
        quote: `Exact evidence number ${index + 5}`,
        supports: true,
      })),
      confidence: 0.95,
      material: true,
      status: "verified",
    },
  ];
  const now = new Date().toISOString();
  const report: ResearchRunReport = {
    runId: "run-1",
    query: "Test question",
    mode: "certified",
    status: "certifying",
    plan: {
      objective: "Answer",
      questions: [
        { id: "Q1", question: "First?", priority: "required" },
        { id: "Q2", question: "Second?", priority: "required" },
      ],
      queries: [
        { query: "query one", questionIds: ["Q1"], preferredSourceTypes: ["primary"] },
        { query: "query two", questionIds: ["Q2"], preferredSourceTypes: ["primary"] },
      ],
      sourceRequirements: ["primary"],
      riskLevel: "normal",
      stopConditions: ["supported"],
    },
    sources,
    claims,
    findings: [],
    attempts: [
      {
        id: "A1",
        role: "planner",
        modelId: "frontier",
        provider: "codex",
        model: "gpt-5.6-sol",
        startedAt: now,
        endedAt: now,
        status: "succeeded",
        local: false,
        reservedMemoryGb: 0,
      },
      {
        id: "A2",
        role: "finalizer",
        modelId: "frontier",
        provider: "codex",
        model: "gpt-5.6-sol",
        startedAt: now,
        endedAt: now,
        status: "succeeded",
        local: false,
        reservedMemoryGb: 0,
      },
    ],
    gaps: [],
    createdAt: now,
    updatedAt: now,
    repairPasses: 0,
    localModelCalls: 0,
    remoteModelCalls: 2,
  };
  const finalization: FinalizationResult = {
    answer: `Fact one [S1] [S2] [S3] [S4]. Fact two [S5] [S6] [S7] [S8].`,
    usedClaimIds: ["C1", "C2"],
    limitations: [],
    attempts: [],
  };
  return { config, registry, report, finalization };
}

describe("deterministicCertification", () => {
  it("adapts diversity only when every planned query intentionally uses the same site set", () => {
    const data = fixture();
    data.report.plan!.queries = data.report.plan!.queries.map((query) =>
      Object.assign({}, query, { query: `site:sqlite.org ${query.query}` }),
    );
    expect(effectiveMinimumDomains(data.report.plan, 4)).toBe(1);
    data.report.plan!.queries[1].query = "sqlite WAL independent analysis";
    expect(effectiveMinimumDomains(data.report.plan, 4)).toBe(4);
  });

  it("certifies a complete, resolved, same-threshold frontier result", () => {
    const data = fixture();
    const result = deterministicCertification(data);
    expect(result.hardGateFailures).toEqual([]);
    expect(result.score).toBeGreaterThanOrEqual(93);
    expect(result.certified).toBe(true);
  });

  it("accepts qualified planner provenance when a replay reuses a fixed plan", () => {
    const data = fixture();
    data.report.attempts = data.report.attempts.filter((attempt) => attempt.role !== "planner");
    data.report.planProvenance = {
      modelId: "frontier",
      provider: "codex",
      model: "gpt-5.6-sol",
      generatedAt: new Date().toISOString(),
      planSha256: researchPlanSha256(data.report.plan!),
      sourceRunId: "source-run",
    };
    expect(deterministicCertification(data).certified).toBe(true);

    data.report.planProvenance.modelId = "unqualified";
    const unqualified = deterministicCertification(data);
    expect(unqualified.certified).toBe(false);
    expect(unqualified.hardGateFailures.join(" ")).toMatch(/planner provenance/i);

    data.report.planProvenance.modelId = "frontier";
    data.report.planProvenance.planSha256 = "0".repeat(64);
    expect(deterministicCertification(data).certified).toBe(false);
  });

  it("reduces completeness when disclosed evidence gaps overlap required questions", () => {
    const data = fixture();
    data.report.plan!.questions[0].question =
      "What snapshot isolation and reader concurrency limits apply?";
    data.report.plan!.questions[1].question =
      "What writer contention and SQLITE_BUSY conditions apply?";
    data.finalization.limitations = [
      "The evidence does not establish every snapshot isolation and reader concurrency limit.",
      "The ledger does not verify every writer contention and SQLITE_BUSY condition.",
    ];

    const result = deterministicCertification(data);
    const completeness = result.dimensions.find((item) => item.id === "completeness");
    expect(completeness?.score).toBe(70);
    expect(completeness?.notes.join(" ")).toMatch(/Q1, Q2/);
  });

  it("uses shared-query provenance and live canonical documents for freshness", () => {
    const data = fixture();
    data.report.plan!.queries[1] = {
      ...data.report.plan!.queries[1],
      freshnessDays: 30,
    };
    for (const source of data.report.sources.slice(4)) {
      source.query = "different ranking query";
      source.matchedQueries = ["query two", "different ranking query"];
      source.sourceType = "primary";
      delete source.publishedAt;
    }

    const result = deterministicCertification(data);
    expect(result.dimensions.find((item) => item.id === "freshness")?.score).toBe(90);
    expect(result.certified).toBe(true);
  });

  it("fails closed when citation coverage is incomplete", () => {
    const data = fixture();
    data.finalization.answer = "Fact one [S1]. Fact two [S5].";
    const result = deterministicCertification(data);
    expect(result.certified).toBe(false);
    expect(result.hardGateFailures.join(" ")).toMatch(/citation coverage/i);
  });

  it("fails closed when fetched or cited sources do not independently support used claims", () => {
    const data = fixture();
    data.report.claims[0].evidence[3].supports = false;
    const result = deterministicCertification(data);
    expect(result.certified).toBe(false);
    expect(result.hardGateFailures.join(" ")).toMatch(
      /supporting fetched source count|supporting source precision/i,
    );
  });

  it("fails closed on unknown or duplicate finalizer claim IDs", () => {
    const data = fixture();
    data.finalization.usedClaimIds = ["C1", "C2", "C2", "C404"];
    const result = deterministicCertification(data);
    expect(result.certified).toBe(false);
    expect(result.hardGateFailures.join(" ")).toMatch(/unknown claim IDs: C404/i);
    expect(result.hardGateFailures.join(" ")).toMatch(/repeats claim IDs: C2/i);
  });

  it("fails closed when the final answer omits a required or important plan question", () => {
    const data = fixture();
    data.report.plan!.questions[1].priority = "important";
    data.finalization.usedClaimIds = ["C1"];
    data.finalization.answer = "Fact one [S1] [S2] [S3] [S4].";
    const result = deterministicCertification(data);
    expect(result.certified).toBe(false);
    expect(result.hardGateFailures).toContain("Required question coverage is incomplete: Q2.");
  });

  it("never certifies best-effort mode even at a high score", () => {
    const data = fixture();
    data.report.mode = "best-effort";
    const result = deterministicCertification(data);
    expect(result.certified).toBe(false);
    expect(result.hardGateFailures).toContain("Run was requested in best-effort mode.");
  });
});

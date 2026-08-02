import { describe, expect, it, vi } from "vitest";
import { resolveResearchManagerConfig } from "./config.js";
import type { StructuredModelRunner, StructuredModelRunOptions } from "./model-runner.js";
import {
  mergeResearchClaims,
  runLocalResearchTeam,
  selectRelevantSourceExcerpt,
  verifyResearchClaims,
} from "./team.js";
import type { ResearchClaim, ResearchFinding, ResearchPlan, ResearchSource } from "./types.js";

const plan: ResearchPlan = {
  objective: "Test",
  questions: [
    { id: "Q1", question: "First?", priority: "required" },
    { id: "Q2", question: "Second?", priority: "required" },
  ],
  queries: [
    { query: "first", questionIds: ["Q1"], preferredSourceTypes: ["primary"] },
    { query: "second", questionIds: ["Q2"], preferredSourceTypes: ["primary"] },
  ],
  sourceRequirements: ["primary"],
  riskLevel: "normal",
  stopConditions: ["supported"],
};

function source(id: string, query: string, content: string): ResearchSource {
  return {
    id,
    query,
    url: `https://${id.toLowerCase()}.example/report`,
    domain: `${id.toLowerCase()}.example`,
    title: id,
    snippet: content,
    content,
    retrievedAt: new Date().toISOString(),
    searchProvider: "test",
    sourceType: "primary",
    fetchStatus: "fetched",
  };
}

describe("Research Manager local team", () => {
  it("runs three logical workers while reserving one as an independent critic", async () => {
    const runJson = vi.fn(async (options: StructuredModelRunOptions) => ({
      value: { summary: options.role, claims: [], gaps: [] },
      attempts: [],
    }));
    const result = await runLocalResearchTeam({
      runner: { runJson } as unknown as StructuredModelRunner,
      config: resolveResearchManagerConfig({ resourceLimits: { maxLogicalWorkers: 3 } }),
      mode: "best-effort",
      query: "Test",
      plan,
      sources: [
        source("S1", "first", "First evidence statement."),
        source("S2", "second", "Second evidence statement."),
      ],
    });
    expect(result.findings).toHaveLength(3);
    expect(runJson).toHaveBeenCalledTimes(3);
    expect(runJson.mock.calls.map((call) => call[0].role)).toEqual([
      "researcher",
      "researcher",
      "critic",
    ]);
    const prompts = runJson.mock.calls.map((call) => call[0].prompt);
    expect(prompts.every((prompt) => !prompt.includes("Assigned questions: []"))).toBe(true);
    expect(prompts[0]).toContain('"id":"S1"');
    expect(prompts[0]).not.toContain('"id":"S2"');
    expect(prompts[1]).toContain('"id":"S2"');
    expect(prompts[1]).not.toContain('"id":"S1"');
    expect(prompts[2]).toContain('"id":"S1"');
    expect(prompts[2]).toContain('"id":"S2"');
    expect(prompts[0]).toContain("exactly one independently verifiable proposition");
    expect(runJson).toHaveBeenCalledWith(
      expect.objectContaining({
        requiredContextTokens: 12_000,
        maxTokens: 1_800,
        schema: expect.objectContaining({
          properties: expect.objectContaining({
            claims: expect.objectContaining({ maxItems: 12 }),
          }),
        }),
      }),
    );
    expect(prompts[0]).toContain("Return at most 4 claims and at most 8 gaps");
  });

  it("retains successful workers when one exhausts all qualified fallbacks", async () => {
    const runJson = vi.fn(async (options: StructuredModelRunOptions) => {
      if (options.prompt.includes("research worker W1")) {
        throw new Error("all W1 candidates failed");
      }
      return {
        value: { summary: options.role, claims: [], gaps: [] },
        attempts: [],
      };
    });
    const result = await runLocalResearchTeam({
      runner: { runJson } as unknown as StructuredModelRunner,
      config: resolveResearchManagerConfig({ resourceLimits: { maxLogicalWorkers: 3 } }),
      mode: "certified",
      query: "Test",
      plan,
      sources: [source("S1", "first", "First evidence statement.")],
    });
    expect(result.findings).toHaveLength(3);
    expect(result.findings[0]?.claims).toEqual([]);
    expect(result.findings[0]?.gaps.join(" ")).toMatch(/all W1 candidates failed/);
    expect(result.findings.slice(1).every((finding) => finding.gaps.length === 0)).toBe(true);
  });

  it("bounds worker dispatch to the configured local compute slots", async () => {
    let active = 0;
    let maxActive = 0;
    const runJson = vi.fn(async (options: StructuredModelRunOptions) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
      active -= 1;
      return { value: { summary: options.role, claims: [], gaps: [] }, attempts: [] };
    });
    await runLocalResearchTeam({
      runner: { runJson } as unknown as StructuredModelRunner,
      config: resolveResearchManagerConfig({
        resourceLimits: { maxLocalParallel: 1, maxLogicalWorkers: 5 },
      }),
      mode: "certified",
      query: "Test",
      plan,
      sources: [source("S1", "first", "First evidence statement.")],
    });
    expect(maxActive).toBe(1);
  });

  it("shares a deduplicated source with every worker whose query it matched", async () => {
    const runJson = vi.fn(async (options: StructuredModelRunOptions) => ({
      value: { summary: options.role, claims: [], gaps: [] },
      attempts: [],
    }));
    const shared = source("S1", "first", "Evidence relevant to both questions.");
    shared.matchedQueries = ["first", "second"];
    await runLocalResearchTeam({
      runner: { runJson } as unknown as StructuredModelRunner,
      config: resolveResearchManagerConfig({ resourceLimits: { maxLogicalWorkers: 3 } }),
      mode: "best-effort",
      query: "Test",
      plan,
      sources: [shared],
    });
    const prompts = runJson.mock.calls.map((call) => call[0].prompt);
    expect(prompts).toHaveLength(3);
    expect(prompts.every((prompt) => prompt.includes('"id":"S1"'))).toBe(true);
  });

  it("adds a semantically relevant source when search-query routing assigned it elsewhere", async () => {
    const runJson = vi.fn(async (options: StructuredModelRunOptions) => ({
      value: { summary: options.role, claims: [], gaps: [] },
      attempts: [],
    }));
    const semanticPlan: ResearchPlan = {
      ...plan,
      questions: [
        {
          id: "Q1",
          question: "What snapshot does a read transaction retain after later commits?",
          priority: "required",
        },
        { id: "Q2", question: "Which busy error can a writer return?", priority: "required" },
      ],
    };
    await runLocalResearchTeam({
      runner: { runJson } as unknown as StructuredModelRunner,
      config: resolveResearchManagerConfig({ resourceLimits: { maxLogicalWorkers: 3 } }),
      mode: "certified",
      query: "Explain WAL concurrency.",
      plan: semanticPlan,
      sources: [
        source(
          "S1",
          "second",
          "The read transaction keeps its original snapshot and does not observe later commits.",
        ),
        source("S2", "first", "A writer may return a busy result."),
      ],
    });
    const q1Prompt = runJson.mock.calls[0]?.[0].prompt ?? "";
    expect(q1Prompt).toContain('"id":"S1"');
    expect(q1Prompt).toContain("original snapshot");
  });

  it("dedicates one default-team researcher to all-source coverage", async () => {
    const runJson = vi.fn(async (options: StructuredModelRunOptions) => ({
      value: { summary: options.role, claims: [], gaps: [] },
      attempts: [],
    }));
    const expandedPlan: ResearchPlan = {
      ...plan,
      questions: Array.from({ length: 5 }, (_, index) => ({
        id: `Q${index + 1}`,
        question: `Question ${index + 1}?`,
        priority: "required" as const,
      })),
      queries: Array.from({ length: 5 }, (_, index) => ({
        query: `query-${index + 1}`,
        questionIds: [`Q${index + 1}`],
        preferredSourceTypes: ["primary"],
      })),
    };
    await runLocalResearchTeam({
      runner: { runJson } as unknown as StructuredModelRunner,
      config: resolveResearchManagerConfig({ resourceLimits: { maxLogicalWorkers: 5 } }),
      mode: "best-effort",
      query: "Test",
      plan: expandedPlan,
      sources: Array.from({ length: 5 }, (_, index) =>
        source(`S${index + 1}`, `query-${index + 1}`, `Evidence ${index + 1}.`),
      ),
    });
    expect(runJson).toHaveBeenCalledTimes(10);
    const coverageCalls = runJson.mock.calls
      .map((call) => call[0])
      .filter((call) => call.prompt.includes("Audit source coverage"));
    expect(coverageCalls).toHaveLength(2);
    expect(coverageCalls.every((call) => call.role === "researcher")).toBe(true);
    expect(coverageCalls.every((call) => call.maxTokens === 2_000)).toBe(true);
    expect(
      coverageCalls.every((call) =>
        call.prompt.includes("Return at most 4 claims and at most 8 gaps"),
      ),
    ).toBe(true);
    const combinedCoveragePrompts = coverageCalls.map((call) => call.prompt).join("\n");
    for (let index = 1; index <= 5; index += 1) {
      expect(combinedCoveragePrompts).toContain(`"id":"S${index}"`);
    }
  });

  it("splits multi-question workers into bounded calls and aggregates logical findings", async () => {
    const expandedPlan: ResearchPlan = {
      ...plan,
      questions: Array.from({ length: 4 }, (_, index) => ({
        id: `Q${index + 1}`,
        question: `Question ${index + 1}?`,
        priority: "required" as const,
      })),
      queries: Array.from({ length: 4 }, (_, index) => ({
        query: `query-${index + 1}`,
        questionIds: [`Q${index + 1}`],
        preferredSourceTypes: ["primary"],
      })),
    };
    const runJson = vi.fn(async (options: StructuredModelRunOptions) => ({
      value: { summary: options.role, claims: [], gaps: [] },
      attempts: [],
    }));
    const result = await runLocalResearchTeam({
      runner: { runJson } as unknown as StructuredModelRunner,
      config: resolveResearchManagerConfig({ resourceLimits: { maxLogicalWorkers: 3 } }),
      mode: "certified",
      query: "Test",
      plan: expandedPlan,
      sources: Array.from({ length: 4 }, (_, index) =>
        source(`S${index + 1}`, `query-${index + 1}`, `Evidence ${index + 1}.`),
      ),
    });
    expect(result.findings).toHaveLength(3);
    expect(runJson).toHaveBeenCalledTimes(6);
    const prompts = runJson.mock.calls.map((call) => call[0].prompt);
    expect(prompts.filter((prompt) => prompt.includes("research worker W1,"))).toHaveLength(2);
    expect(prompts.filter((prompt) => prompt.includes("research worker W2,"))).toHaveLength(2);
    expect(prompts.filter((prompt) => prompt.includes("research worker W3,"))).toHaveLength(2);
    expect(prompts.every((prompt) => prompt.length < 20_000)).toBe(true);
  });

  it("checkpoints bounded findings and reuses them without repeating model calls", async () => {
    const checkpointed: ResearchFinding[] = [];
    const runJson = vi.fn(async (options: StructuredModelRunOptions) => ({
      value: { summary: options.role, claims: [], gaps: [] },
      attempts: [],
    }));
    const first = await runLocalResearchTeam({
      runner: { runJson } as unknown as StructuredModelRunner,
      config: resolveResearchManagerConfig({ resourceLimits: { maxLogicalWorkers: 3 } }),
      mode: "certified",
      query: "Test",
      plan,
      sources: [
        source("S1", "first", "First evidence statement."),
        source("S2", "second", "Second evidence statement."),
      ],
      onFinding: (finding) => {
        checkpointed.push(structuredClone(finding));
      },
    });
    expect(runJson).toHaveBeenCalledTimes(3);
    expect(checkpointed.map((finding) => finding.workerId)).toEqual(["W1.1", "W2.1", "W3.1"]);

    const resumedRunJson = vi.fn();
    const resumed = await runLocalResearchTeam({
      runner: { runJson: resumedRunJson } as unknown as StructuredModelRunner,
      config: resolveResearchManagerConfig({ resourceLimits: { maxLogicalWorkers: 3 } }),
      mode: "certified",
      query: "Test",
      plan,
      sources: [
        source("S1", "first", "First evidence statement."),
        source("S2", "second", "Second evidence statement."),
      ],
      existingFindings: checkpointed,
    });
    expect(resumedRunJson).not.toHaveBeenCalled();
    expect(resumed.findings).toEqual(first.findings);
  });

  it("selects bounded source excerpts by question relevance instead of document prefix", () => {
    const document = `${"unrelated introduction ".repeat(300)}\nNetwork filesystems cannot use WAL shared memory across hosts.`;
    const excerpt = selectRelevantSourceExcerpt(
      source("S1", "network filesystem WAL", document),
      "What same-host and network filesystem limitations apply?",
      1_900,
    );
    expect(excerpt).toContain("Network filesystems cannot use WAL shared memory across hosts.");
    expect(excerpt.length).toBeLessThanOrEqual(1_900);
  });

  it("keeps overlap so terms split at a chunk boundary remain discoverable", () => {
    const document = `${"x".repeat(1_798)}checkpoint${"y".repeat(2_500)}`;
    const excerpt = selectRelevantSourceExcerpt(
      source("S1", "WAL checkpoint", document),
      "How does checkpoint behavior affect readers?",
      1_800,
    );
    expect(excerpt).toContain("checkpoint");
    expect(excerpt.length).toBeLessThanOrEqual(1_800);
  });

  it("covers multiple focus facets instead of falling back to a short document prefix", () => {
    const filler = "unrelated background material ".repeat(25);
    const document = [
      `Each reader records its own end mark for its snapshot. ${filler}`,
      `WAL does not work over a network filesystem. ${filler}`,
      `The page size cannot change while WAL mode is active. ${filler}`,
    ].join("\n");
    const excerpt = selectRelevantSourceExcerpt(
      source("S1", "SQLite WAL constraints", document),
      [
        "How is each reader end mark selected for its snapshot?",
        "Can WAL operate across a network filesystem?",
        "Can page size change while WAL mode is active?",
      ].join("\n"),
      900,
    );
    expect(excerpt).toContain("Each reader records its own end mark");
    expect(excerpt).toContain("WAL does not work over a network filesystem");
    expect(excerpt).toContain("page size cannot change while WAL mode is active");
    expect(excerpt.length).toBeLessThanOrEqual(900);
  });

  it("deduplicates semantically equivalent claims while preserving distinct evidence", () => {
    const findings: ResearchFinding[] = [
      {
        workerId: "W1",
        role: "researcher",
        questionIds: ["Q1"],
        summary: "",
        gaps: [],
        claims: [
          {
            id: "one",
            questionId: "Q1",
            text: "The launch occurred on 14 March 2024.",
            sourceIds: ["S1"],
            evidence: [
              { sourceId: "S1", quote: "launch occurred on 14 March 2024", supports: true },
            ],
            confidence: 0.9,
            material: true,
            status: "proposed",
          },
        ],
      },
      {
        workerId: "W2",
        role: "researcher",
        questionIds: ["Q1"],
        summary: "",
        gaps: [],
        claims: [
          {
            id: "two",
            questionId: "Q1",
            text: "Launch occurred on March 14, 2024.",
            sourceIds: ["S2"],
            evidence: [
              { sourceId: "S2", quote: "Launch occurred on March 14, 2024", supports: true },
            ],
            confidence: 0.95,
            material: true,
            status: "proposed",
          },
        ],
      },
    ];
    const merged = mergeResearchClaims(findings);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.sourceIds).toEqual(["S1", "S2"]);
    expect(merged[0]?.evidence).toHaveLength(2);
  });

  it("fails deterministic quote containment even when the verifier says verified", async () => {
    const claim: ResearchClaim = {
      id: "C1",
      questionId: "Q1",
      text: "A fabricated claim.",
      sourceIds: ["S1"],
      evidence: [{ sourceId: "S1", quote: "fabricated exact evidence statement", supports: true }],
      confidence: 0.99,
      material: true,
      status: "proposed",
    };
    const runner = {
      runJson: async () => ({
        value: {
          results: [
            {
              claimId: "C1",
              status: "verified",
              confidence: 1,
              reason: "looks supported",
              supportingSourceIds: ["S1"],
            },
          ],
          gaps: [],
        },
        attempts: [],
      }),
    } as unknown as StructuredModelRunner;
    const result = await verifyResearchClaims({
      runner,
      config: resolveResearchManagerConfig(undefined),
      mode: "best-effort",
      plan,
      claims: [claim],
      sources: [source("S1", "first", "The actual exact evidence statement is different.")],
    });
    expect(result.claims[0]?.status).toBe("unsupported");
    expect(result.gaps.join(" ")).toMatch(/material claim C1 is unsupported/i);
  });

  it("batches large claim ledgers without truncating verifier JSON", async () => {
    const evidence = source("S1", "first", "The exact evidence supports every bounded test claim.");
    const claims: ResearchClaim[] = Array.from({ length: 21 }, (_, index) => ({
      id: `C${index + 1}`,
      questionId: "Q1",
      text: `Bounded test claim ${index + 1}.`,
      sourceIds: ["S1"],
      evidence: [
        {
          sourceId: "S1",
          quote: "The exact evidence supports every bounded test claim.",
          supports: true,
        },
      ],
      confidence: 0.95,
      material: true,
      status: "proposed",
    }));
    let active = 0;
    let maxActive = 0;
    const runJson = vi.fn(async ({ prompt }: StructuredModelRunOptions) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
      const claimsJson = prompt.split("CLAIMS_JSON: ")[1]?.split("\n\nUNTRUSTED_SOURCES_JSON:")[0];
      const batch = JSON.parse(claimsJson ?? "[]") as ResearchClaim[];
      active -= 1;
      return {
        value: {
          results: batch.map((claim) => ({
            claimId: claim.id,
            status: "verified",
            confidence: 0.95,
            reason: "Directly entailed.",
            supportingSourceIds: ["S1"],
          })),
          gaps: [],
        },
        attempts: [],
      };
    });
    const result = await verifyResearchClaims({
      runner: { runJson } as unknown as StructuredModelRunner,
      config: resolveResearchManagerConfig({ resourceLimits: { maxLocalParallel: 2 } }),
      mode: "certified",
      plan,
      claims,
      sources: [evidence],
    });
    expect(runJson).toHaveBeenCalledTimes(3);
    expect(maxActive).toBe(2);
    expect(result.claims).toHaveLength(21);
    expect(result.claims.every((claim) => claim.status === "verified")).toBe(true);
    expect(result.gaps).toEqual([]);
  });

  it("sends quote-centered source context to the verifier when evidence is beyond the prefix", async () => {
    const exactQuote = "The transaction keeps the same end mark for its entire read transaction.";
    const evidence = source("S1", "snapshot", `${"prefix material ".repeat(1_000)}${exactQuote}`);
    const claim: ResearchClaim = {
      id: "C1",
      questionId: "Q1",
      text: "A read transaction keeps the same end mark for its duration.",
      sourceIds: ["S1"],
      evidence: [{ sourceId: "S1", quote: exactQuote, supports: true }],
      confidence: 1,
      material: true,
      status: "proposed",
    };
    const runJson = vi.fn(async ({ prompt }: StructuredModelRunOptions) => {
      expect(prompt).toContain(exactQuote);
      expect(prompt).toContain('ASSIGNED_QUESTIONS_JSON: [{"id":"Q1","question":"First?"');
      expect(prompt).toContain("materially answer the question identified by its questionId");
      return {
        value: {
          results: [
            {
              claimId: "C1",
              status: "verified",
              confidence: 1,
              reason: "Directly entailed.",
              supportingSourceIds: ["S1"],
            },
          ],
          gaps: [],
        },
        attempts: [],
      };
    });
    const result = await verifyResearchClaims({
      runner: { runJson } as unknown as StructuredModelRunner,
      config: resolveResearchManagerConfig(),
      mode: "certified",
      plan,
      claims: [claim],
      sources: [evidence],
    });
    expect(result.claims[0]?.status).toBe("verified");
  });

  it("rechecks a material first-pass false negative in a smaller fresh batch", async () => {
    const exactQuote =
      "Beginning with version 3.11.0, WAL works efficiently with large transactions.";
    const claim: ResearchClaim = {
      id: "C1",
      questionId: "Q1",
      text: "Beginning with version 3.11.0, WAL works efficiently with large transactions.",
      sourceIds: ["S1"],
      evidence: [{ sourceId: "S1", quote: exactQuote, supports: true }],
      confidence: 1,
      material: true,
      status: "proposed",
    };
    let invocation = 0;
    const runJson = vi.fn(async ({ prompt }: StructuredModelRunOptions) => {
      invocation += 1;
      if (invocation === 2) {
        expect(prompt).toMatch(/fresh context/i);
      }
      return {
        value: {
          results: [
            {
              claimId: "C1",
              status: invocation === 1 ? "unsupported" : "verified",
              confidence: 1,
              reason: invocation === 1 ? "First pass was too conservative." : "Directly entailed.",
              supportingSourceIds: invocation === 1 ? [] : ["S1"],
            },
          ],
          gaps: [],
        },
        attempts: [],
      };
    });
    const result = await verifyResearchClaims({
      runner: { runJson } as unknown as StructuredModelRunner,
      config: resolveResearchManagerConfig(),
      mode: "certified",
      plan,
      claims: [claim],
      sources: [source("S1", "large transactions", exactQuote)],
    });
    expect(runJson).toHaveBeenCalledTimes(2);
    expect(result.claims[0]?.status).toBe("verified");
    expect(result.claims[0]?.evidence[0]?.supports).toBe(true);
  });

  it("rechecks a required-question orphan one claim at a time", async () => {
    const exactQuote = "It is not possible to change the page_size after entering WAL mode.";
    const claim: ResearchClaim = {
      id: "C1",
      questionId: "Q1",
      text: "A database page size cannot be changed after entering WAL mode.",
      sourceIds: ["S1"],
      evidence: [{ sourceId: "S1", quote: exactQuote, supports: true }],
      confidence: 1,
      material: true,
      status: "proposed",
    };
    let invocation = 0;
    const runJson = vi.fn(async ({ prompt }: StructuredModelRunOptions) => {
      invocation += 1;
      if (invocation === 3) {
        expect(prompt).toMatch(/Required question Q1 still has no independently verified claim/i);
        const claimsJson = prompt
          .split("CLAIMS_JSON: ")[1]
          ?.split("\n\nUNTRUSTED_SOURCES_JSON:")[0];
        expect(JSON.parse(claimsJson ?? "[]")).toHaveLength(1);
      }
      return {
        value: {
          results: [
            {
              claimId: "C1",
              status: invocation === 3 ? "verified" : "unsupported",
              confidence: 1,
              reason: invocation === 3 ? "Directly entailed." : "Conservative false negative.",
              supportingSourceIds: invocation === 3 ? ["S1"] : [],
            },
          ],
          gaps: [],
        },
        attempts: [],
      };
    });
    const result = await verifyResearchClaims({
      runner: { runJson } as unknown as StructuredModelRunner,
      config: resolveResearchManagerConfig(),
      mode: "certified",
      plan,
      claims: [claim],
      sources: [source("S1", "page size", exactQuote)],
    });
    expect(runJson).toHaveBeenCalledTimes(3);
    expect(result.claims[0]?.status).toBe("verified");
    expect(result.gaps).toEqual([]);
  });

  it("never rechecks a disputed required-question claim", async () => {
    const supportingQuote = "The documented setting is immutable.";
    const opposingQuote = "A later document says the setting can change.";
    const claim: ResearchClaim = {
      id: "C1",
      questionId: "Q1",
      text: "The documented setting is immutable.",
      sourceIds: ["S1", "S2"],
      evidence: [
        { sourceId: "S1", quote: supportingQuote, supports: true },
        { sourceId: "S2", quote: opposingQuote, supports: true },
      ],
      confidence: 0.8,
      material: true,
      status: "proposed",
    };
    const runJson = vi.fn(async () => ({
      value: {
        results: [
          {
            claimId: "C1",
            status: "disputed",
            confidence: 0.8,
            reason: "The sources conflict.",
            supportingSourceIds: ["S1"],
            contradiction: opposingQuote,
            contradictionSourceIds: ["S2"],
          },
        ],
        gaps: [],
      },
      attempts: [],
    }));
    const result = await verifyResearchClaims({
      runner: { runJson } as unknown as StructuredModelRunner,
      config: resolveResearchManagerConfig(),
      mode: "certified",
      plan,
      claims: [claim],
      sources: [
        source("S1", "supporting", supportingQuote),
        source("S2", "opposing", opposingQuote),
      ],
    });
    expect(runJson).toHaveBeenCalledTimes(1);
    expect(result.claims[0]?.status).toBe("disputed");
    expect(result.gaps.join(" ")).toMatch(/Q1 has no independently verified claim/i);
  });

  it("fails closed when a verifier approves a claim without an eligible supporting source", async () => {
    const exactQuote = "The filing date was 2 May 2025.";
    const claim: ResearchClaim = {
      id: "C1",
      questionId: "Q1",
      text: exactQuote,
      sourceIds: ["S1"],
      evidence: [{ sourceId: "S1", quote: exactQuote, supports: true }],
      confidence: 1,
      material: true,
      status: "proposed",
    };
    const runner = {
      runJson: async () => ({
        value: {
          results: [
            {
              claimId: "C1",
              status: "verified",
              confidence: 1,
              reason: "Approved without source attribution.",
              supportingSourceIds: [],
            },
          ],
          gaps: [],
        },
        attempts: [],
      }),
    } as unknown as StructuredModelRunner;
    const result = await verifyResearchClaims({
      runner,
      config: resolveResearchManagerConfig(),
      mode: "certified",
      plan,
      claims: [claim],
      sources: [source("S1", "filing", exactQuote)],
    });
    expect(result.claims[0]?.status).toBe("unsupported");
    expect(result.claims[0]?.evidence[0]?.supports).toBe(false);
    expect(result.gaps.join(" ")).toMatch(/without an eligible supporting source/i);
  });

  it("retains support only for sources independently approved by the verifier", async () => {
    const claimText = "The launch occurred on 14 March 2024.";
    const claim: ResearchClaim = {
      id: "C1",
      questionId: "Q1",
      text: claimText,
      sourceIds: ["S1", "S2"],
      evidence: [
        { sourceId: "S1", quote: claimText, supports: true },
        { sourceId: "S2", quote: "A launch was discussed in this article.", supports: true },
      ],
      confidence: 1,
      material: true,
      status: "proposed",
    };
    const runner = {
      runJson: async () => ({
        value: {
          results: [
            {
              claimId: "C1",
              status: "verified",
              confidence: 1,
              reason: "Only S1 directly entails the exact date.",
              supportingSourceIds: ["S1"],
            },
          ],
          gaps: [],
        },
        attempts: [],
      }),
    } as unknown as StructuredModelRunner;
    const result = await verifyResearchClaims({
      runner,
      config: resolveResearchManagerConfig(),
      mode: "certified",
      plan,
      claims: [claim],
      sources: [
        source("S1", "primary", claimText),
        source("S2", "secondary", "A launch was discussed in this article."),
      ],
    });
    expect(result.claims[0]?.status).toBe("verified");
    expect(result.claims[0]?.evidence).toEqual([
      { sourceId: "S1", quote: claimText, supports: true },
      { sourceId: "S2", quote: "A launch was discussed in this article.", supports: false },
    ]);
  });
});

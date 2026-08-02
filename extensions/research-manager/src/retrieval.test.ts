import { describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "../api.js";
import { resolveResearchManagerConfig } from "./config.js";
import type { StructuredModelRunner } from "./model-runner.js";
import {
  collectSearchCandidates,
  deduplicateResearchSources,
  rankResearchSourceCandidate,
  retrieveResearchSources,
} from "./retrieval.js";
import type { ResearchPlan, ResearchSource } from "./types.js";

function source(overrides: Partial<ResearchSource>): ResearchSource {
  return {
    id: "S1",
    query: "query",
    url: "https://example.com/report",
    domain: "example.com",
    title: "Report",
    snippet: "Evidence",
    retrievedAt: new Date().toISOString(),
    searchProvider: "test",
    sourceType: "unknown",
    fetchStatus: "fetched",
    ...overrides,
  };
}

describe("Research Manager retrieval helpers", () => {
  it("strips current OpenClaw untrusted-content envelopes from search fields", () => {
    const [candidate] = collectSearchCandidates({
      results: [
        {
          url: "https://sqlite.org/wal.html",
          title:
            '\n<<<EXTERNAL_UNTRUSTED_CONTENT id="title">>>\nSource: Web Search\n---\nWrite-Ahead Logging - SQLite\n<<<END_EXTERNAL_UNTRUSTED_CONTENT id="title">>>',
          snippet:
            '\n<<<EXTERNAL_UNTRUSTED_CONTENT id="snippet">>>\nSource: Web Search\n---\nWAL provides more concurrency.\n<<<END_EXTERNAL_UNTRUSTED_CONTENT id="snippet">>>',
        },
      ],
    });
    expect(candidate).toEqual({
      url: "https://sqlite.org/wal.html",
      title: "Write-Ahead Logging - SQLite",
      snippet: "WAL provides more concurrency.",
    });
  });

  it("infers freshness metadata from dated release-result text", () => {
    const [candidate] = collectSearchCandidates({
      results: [
        {
          url: "https://sqlite.org/releaselog/3_53_1.html",
          title: "SQLite Release 3.53.1 On 2026-05-05",
          snippet: "Changes in this patch release.",
        },
      ],
    });
    expect(candidate?.publishedAt).toBe("2026-05-05T00:00:00.000Z");
  });

  it("ranks primary HTTPS sources above affiliate blog results", () => {
    const primary = rankResearchSourceCandidate({
      url: "https://www.sec.gov/rules/final/2026-rule",
      title: "Final rule",
      snippet: "Official final rule text and publication date.",
    });
    const blog = rankResearchSourceCandidate({
      url: "http://example.com/affiliate/post",
      title: "Opinion",
      snippet: "A long opinion about the rule that is not the rule itself.".repeat(3),
    });
    expect(primary).toBeGreaterThan(blog);
  });

  it("ranks planned official documentation above a forum hosted on the same domain", () => {
    const query = "site:sqlite.org WAL reader snapshot";
    const planned: ResearchPlan = {
      objective: "Use SQLite documentation",
      questions: [{ id: "Q1", question: "How do snapshots work?", priority: "required" }],
      queries: [
        {
          query,
          questionIds: ["Q1"],
          preferredSourceTypes: ["official SQLite documentation"],
        },
      ],
      sourceRequirements: ["official"],
      riskLevel: "normal",
      stopConditions: ["supported"],
    };
    const documentation = rankResearchSourceCandidate(
      {
        url: "https://sqlite.org/wal.html",
        title: "Write-Ahead Logging",
        snippet: "Official WAL documentation.",
      },
      query,
      planned,
    );
    const forum = rankResearchSourceCandidate(
      {
        url: "https://sqlite.org/forum/forumpost/123",
        title: "User forum discussion",
        snippet: "A forum discussion with a longer excerpt.".repeat(5),
      },
      query,
      planned,
    );
    expect(documentation).toBeGreaterThan(forum);
  });

  it("deduplicates canonical URLs and identical content hashes before assigning IDs", () => {
    const result = deduplicateResearchSources([
      source({ id: "old-1", url: "https://a.example/report?utm_source=x", contentSha256: "one" }),
      source({
        id: "old-2",
        query: "second query",
        url: "https://a.example/report",
        contentSha256: "two",
      }),
      source({
        id: "old-3",
        query: "copy query",
        url: "https://b.example/copy",
        contentSha256: "one",
      }),
      source({ id: "old-4", url: "https://c.example/unique", contentSha256: "three" }),
    ]);
    expect(result.duplicateCount).toBe(2);
    expect(result.sources.map((entry) => entry.id)).toEqual(["S1", "S2"]);
    expect(result.sources.map((entry) => entry.url)).toEqual([
      "https://a.example/report?utm_source=x",
      "https://c.example/unique",
    ]);
    expect(result.sources[0]?.matchedQueries).toEqual(["query", "second query", "copy query"]);
  });

  it("preserves all query associations for shared URLs", async () => {
    const search = vi.fn(async ({ args }: { args: { query: string } }) => ({
      provider: "test-search",
      result: {
        results: [
          {
            url: "https://official.example/shared",
            title: "Shared official source",
            snippet: `Comprehensive authoritative shared evidence for both planned questions, including ${args.query}.`,
          },
          {
            url: `https://official.example/${args.query}`,
            title: `Specific ${args.query}`,
            snippet: `Specific evidence for ${args.query}.`,
          },
        ],
      },
    }));
    const api = {
      config: {},
      runtime: {
        webSearch: { search, listProviders: () => [{ id: "test-search" }] },
      },
    } as unknown as OpenClawPluginApi;
    const result = await retrieveResearchSources({
      api,
      config: resolveResearchManagerConfig({
        retrieval: { queryCount: 2, maxSources: 2 },
        certification: { minSources: 2 },
      }),
      plan: {
        objective: "Cover both questions",
        questions: [
          { id: "Q1", question: "First?", priority: "required" },
          { id: "Q2", question: "Second?", priority: "required" },
        ],
        queries: [
          { query: "first", questionIds: ["Q1"], preferredSourceTypes: ["official"] },
          { query: "second", questionIds: ["Q2"], preferredSourceTypes: ["official"] },
        ],
        sourceRequirements: ["official"],
        riskLevel: "normal",
        stopConditions: ["both questions covered"],
      },
      fetchSourceImpl: vi.fn(async ({ url }: { url: string }) => ({
        finalUrl: url,
        title: url,
        text: `Fetched evidence from ${url}`,
        contentType: "text/plain",
        sha256: new URL(url).pathname === "/shared" ? "a".repeat(64) : url.padEnd(64, "x"),
        promptInjectionSignals: [],
      })) as unknown as Parameters<typeof retrieveResearchSources>[0]["fetchSourceImpl"],
    });
    const shared = result.sources.find((entry) => entry.url.endsWith("/shared"));
    expect(shared?.matchedQueries).toEqual(["first", "second"]);
  });

  it("selects at least one source for every planned query before global ranking", async () => {
    const search = vi.fn(async ({ args }: { args: { query: string } }) => ({
      provider: "test-search",
      result: {
        results: [
          {
            url: `https://same.example/${args.query}`,
            title: args.query,
            snippet: `${args.query} evidence`,
          },
        ],
      },
    }));
    const api = {
      config: {},
      runtime: {
        webSearch: { search, listProviders: () => [{ id: "test-search" }] },
      },
    } as unknown as OpenClawPluginApi;
    const result = await retrieveResearchSources({
      api,
      config: resolveResearchManagerConfig({
        retrieval: { queryCount: 2, maxSources: 2 },
        certification: { minSources: 2 },
      }),
      plan: {
        objective: "Cover both questions",
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
        stopConditions: ["both questions covered"],
      },
      fetchSourceImpl: vi.fn(async ({ url }: { url: string }) => ({
        finalUrl: url,
        title: url,
        text: url,
        contentType: "text/plain",
        sha256: url.endsWith("/first") ? "1".repeat(64) : "2".repeat(64),
        promptInjectionSignals: [],
      })) as unknown as Parameters<typeof retrieveResearchSources>[0]["fetchSourceImpl"],
    });
    expect(result.sources.map((entry) => entry.query).toSorted()).toEqual(["first", "second"]);
  });

  it("uses local scout advice for bounded ranking and query expansion without bypassing fetch policy", async () => {
    const search = vi.fn(async ({ args }: { args: { query: string } }) => ({
      provider: "test-search",
      result: {
        results:
          args.query === "expanded official query"
            ? [
                {
                  url: "https://d.example/report",
                  title: "D",
                  snippet: "Official evidence D.",
                },
              ]
            : [
                {
                  url: "https://a.example/report",
                  title: "A",
                  snippet: "Official evidence A.",
                },
                {
                  url: "https://b.example/report",
                  title: "B",
                  snippet: "Official evidence B.",
                },
                {
                  url: "https://c.example/affiliate/report",
                  title: "C",
                  snippet: "Affiliate opinion C.",
                },
              ],
      },
    }));
    const runJson = vi.fn(async () => ({
      value: {
        rankedSourceIds: ["R2", "R1"],
        rejectedSourceIds: ["R3"],
        queries: ["expanded official query", "expanded official query"],
        risks: ["One result is affiliate content."],
      },
      attempts: [],
    }));
    const fetchSourceImpl = vi.fn(async ({ url }: { url: string }) => ({
      finalUrl: url,
      title: `Fetched ${new URL(url).hostname}`,
      text: `Evidence from ${url}`,
      contentType: "text/plain",
      sha256: url.includes("b.example") ? "b".repeat(64) : "a".repeat(64),
      promptInjectionSignals: [],
    }));
    const api = {
      config: {},
      runtime: {
        webSearch: {
          search,
          listProviders: () => [{ id: "test-search" }],
        },
      },
    } as unknown as OpenClawPluginApi;
    const plan: ResearchPlan = {
      objective: "Answer from official evidence",
      questions: [{ id: "Q1", question: "What happened?", priority: "required" }],
      queries: [{ query: "initial query", questionIds: ["Q1"], preferredSourceTypes: ["primary"] }],
      sourceRequirements: ["official"],
      riskLevel: "normal",
      stopConditions: ["Two sources"],
    };
    const result = await retrieveResearchSources({
      api,
      runner: { runJson } as unknown as StructuredModelRunner,
      mode: "certified",
      config: resolveResearchManagerConfig({
        retrieval: { queryCount: 2, maxSources: 2 },
        certification: { minSources: 2 },
      }),
      plan,
      fetchSourceImpl: fetchSourceImpl as unknown as Parameters<
        typeof retrieveResearchSources
      >[0]["fetchSourceImpl"],
    });
    expect(runJson).toHaveBeenCalledWith(expect.objectContaining({ role: "scout" }));
    expect(search.mock.calls.map((call) => call[0].args.query)).toEqual([
      "initial query",
      "expanded official query",
    ]);
    expect(result.sources.map((entry) => entry.domain)).toEqual(["b.example", "a.example"]);
    expect(result.gaps.join("\n")).toMatch(/Scout risk: One result is affiliate content/);
    expect(fetchSourceImpl).toHaveBeenCalledTimes(2);
  });

  it("falls back across the configured provider order and preserves diagnostics", async () => {
    const search = vi.fn(async ({ providerId }: { providerId?: string }) => {
      if (providerId === "primary-search") {
        throw new Error("primary unavailable");
      }
      return {
        provider: providerId ?? "auto",
        result: {
          results: [
            {
              url: "https://sqlite.org/wal.html",
              title: "Write-Ahead Logging",
              snippet: "Official WAL documentation.",
            },
          ],
        },
      };
    });
    const api = {
      config: {},
      runtime: {
        webSearch: {
          search,
          listProviders: () => [{ id: "primary-search" }, { id: "fallback-search" }],
        },
      },
    } as unknown as OpenClawPluginApi;
    const result = await retrieveResearchSources({
      api,
      config: resolveResearchManagerConfig({
        retrieval: {
          providerOrder: ["primary-search", "fallback-search"],
          fallbackDelayMs: 0,
          queryCount: 1,
          maxSources: 1,
        },
        certification: { minSources: 1 },
      }),
      plan: {
        objective: "Use official SQLite evidence",
        questions: [{ id: "Q1", question: "How does WAL work?", priority: "required" }],
        queries: [
          {
            query: "site:sqlite.org WAL",
            questionIds: ["Q1"],
            preferredSourceTypes: ["primary"],
          },
        ],
        sourceRequirements: ["sqlite.org"],
        riskLevel: "normal",
        stopConditions: ["Official evidence found"],
      },
      fetchSourceImpl: vi.fn(async ({ url }: { url: string }) => ({
        finalUrl: url,
        title: "Write-Ahead Logging",
        text: "Official WAL documentation.",
        contentType: "text/html",
        sha256: "a".repeat(64),
        promptInjectionSignals: [],
      })) as unknown as Parameters<typeof retrieveResearchSources>[0]["fetchSourceImpl"],
    });
    expect(search.mock.calls.map((call) => call[0].providerId)).toEqual([
      "primary-search",
      "fallback-search",
    ]);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]?.searchProvider).toBe("fallback-search");
    expect(result.sources[0]?.sourceType).toBe("primary");
    expect(result.gaps).toContain(
      'Search provider primary-search failed for "site:sqlite.org WAL": primary unavailable',
    );
  });

  it("does not label hosted forum content as primary documentation", async () => {
    const query = "site:sqlite.org WAL";
    const api = {
      config: {},
      runtime: {
        webSearch: {
          search: vi.fn(async () => ({
            provider: "test-search",
            result: {
              results: [
                {
                  url: "https://sqlite.org/forum/forumpost/123",
                  title: "Forum discussion",
                  snippet: "A user discussion about WAL behavior.",
                },
                {
                  url: "https://sqlite.org/wal.html",
                  title: "Write-Ahead Logging",
                  snippet: "Official WAL documentation.",
                },
              ],
            },
          })),
          listProviders: () => [{ id: "test-search" }],
        },
      },
    } as unknown as OpenClawPluginApi;
    const result = await retrieveResearchSources({
      api,
      config: resolveResearchManagerConfig({
        retrieval: { providerOrder: ["test-search"], queryCount: 1, maxSources: 2 },
        certification: { minSources: 1 },
      }),
      plan: {
        objective: "Use official SQLite evidence",
        questions: [{ id: "Q1", question: "How does WAL work?", priority: "required" }],
        queries: [
          {
            query,
            questionIds: ["Q1"],
            preferredSourceTypes: ["official SQLite documentation"],
          },
        ],
        sourceRequirements: ["sqlite.org"],
        riskLevel: "normal",
        stopConditions: ["Official evidence found"],
      },
      fetchSourceImpl: vi.fn(async ({ url }: { url: string }) => ({
        finalUrl: url,
        title: url,
        text: "Fetched content.",
        contentType: "text/html",
        sha256: url.includes("forum") ? "b".repeat(64) : "a".repeat(64),
        promptInjectionSignals: [],
      })) as unknown as Parameters<typeof retrieveResearchSources>[0]["fetchSourceImpl"],
    });
    expect(result.sources.find((item) => item.url.includes("wal.html"))?.sourceType).toBe(
      "primary",
    );
    expect(result.sources.find((item) => item.url.includes("forum"))?.sourceType).toBe("unknown");
  });
});

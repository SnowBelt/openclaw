import { describe, expect, it } from "vitest";
import { resolveResearchManagerConfig } from "./config.js";
import { ModelCapabilityRegistry } from "./model-registry.js";
import { researchPlanSha256 } from "./plan-provenance.js";
import {
  assessDoctorReadiness,
  createCancelledResearchReport,
  createResearchReplaySeed,
  modelProbeIdentity,
  qualificationMatchesCorpus,
  RESEARCH_MODEL_ROLES,
} from "./runtime.js";
import type { ResearchRunReport } from "./types.js";

describe("Research Manager doctor diagnostics", () => {
  it("cancels a durable run without non-serializable undefined fields", () => {
    const current = {
      runId: "active-run",
      query: "Test",
      mode: "certified" as const,
      status: "researching" as const,
      claims: [],
      sources: [],
      findings: [],
      attempts: [],
      gaps: [],
      createdAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:00.000Z",
      blockedReason: "old blocker",
      failure: "old failure",
      repairPasses: 0,
      localModelCalls: 0,
      remoteModelCalls: 0,
    } satisfies ResearchRunReport;
    const cancelled = createCancelledResearchReport(current, "2026-07-17T01:00:00.000Z");
    expect(cancelled).toMatchObject({
      status: "cancelled",
      completedAt: "2026-07-17T01:00:00.000Z",
    });
    expect(Object.hasOwn(cancelled, "blockedReason")).toBe(false);
    expect(Object.hasOwn(cancelled, "failure")).toBe(false);
    expect(() => JSON.stringify(cancelled)).not.toThrow();
  });

  it("creates a clean replay run while preserving the plan and source corpus", () => {
    const source: ResearchRunReport = {
      runId: "source-run",
      query: "What happened?",
      mode: "certified",
      status: "blocked",
      plan: {
        objective: "Answer",
        questions: [{ id: "Q1", question: "What happened?", priority: "required" }],
        queries: [
          { query: "official source", questionIds: ["Q1"], preferredSourceTypes: ["primary"] },
        ],
        sourceRequirements: ["primary"],
        riskLevel: "normal",
        stopConditions: ["supported"],
      },
      sources: [
        {
          id: "S1",
          query: "official source",
          url: "https://example.com/report",
          domain: "example.com",
          title: "Report",
          snippet: "Evidence",
          content: "Evidence",
          retrievedAt: "2026-07-16T00:00:00.000Z",
          searchProvider: "test",
          sourceType: "primary",
          fetchStatus: "fetched",
        },
      ],
      claims: [],
      findings: [],
      attempts: [
        {
          id: "planner-attempt",
          role: "planner",
          modelId: "sol-planner",
          provider: "codex",
          model: "gpt-5.6-sol",
          startedAt: "2026-07-16T00:00:00.000Z",
          endedAt: "2026-07-16T00:01:00.000Z",
          status: "succeeded",
          local: false,
          reservedMemoryGb: 0,
        },
      ],
      gaps: ["old gap"],
      createdAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z",
      completedAt: "2026-07-16T00:00:00.000Z",
      blockedReason: "old failure",
      repairPasses: 2,
      localModelCalls: 3,
      remoteModelCalls: 4,
    };
    const seed = createResearchReplaySeed({
      source,
      runId: "replay-run",
      now: "2026-07-17T00:00:00.000Z",
    });
    expect(seed).toMatchObject({
      runId: "replay-run",
      replayedFromRunId: "source-run",
      status: "queued",
      claims: [],
      findings: [],
      attempts: [],
      gaps: [],
      repairPasses: 0,
      localModelCalls: 0,
      remoteModelCalls: 0,
    });
    expect(seed.planProvenance).toEqual({
      modelId: "sol-planner",
      provider: "codex",
      model: "gpt-5.6-sol",
      generatedAt: "2026-07-16T00:01:00.000Z",
      planSha256: researchPlanSha256(source.plan!),
      sourceRunId: "source-run",
    });
    expect(seed.plan).toEqual(source.plan);
    expect(seed.sources).toEqual(source.sources);
    expect(seed.plan).not.toBe(source.plan);
    expect(seed.sources).not.toBe(source.sources);
  });

  it("accepts qualifications only for the exact active corpus", () => {
    const record = {
      modelId: "sol",
      role: "planner",
      score: 100,
      corpusVersion: "research-manager-role-v3",
      corpusSha256: "a".repeat(64),
      measuredAt: new Date().toISOString(),
    };
    expect(
      qualificationMatchesCorpus(record, {
        version: "research-manager-role-v3",
        sha256: "a".repeat(64),
      }),
    ).toBe(true);
    expect(
      qualificationMatchesCorpus(record, {
        version: "research-manager-role-v3",
        sha256: "b".repeat(64),
      }),
    ).toBe(false);
    expect(
      qualificationMatchesCorpus(
        { ...record, corpusSha256: undefined },
        { version: "research-manager-role-v3", sha256: "a".repeat(64) },
      ),
    ).toBe(false);
  });

  it("deduplicates only identical model probe identities", () => {
    const [planner, general, fallback] = resolveResearchManagerConfig().models;
    expect(modelProbeIdentity(planner)).toBe(modelProbeIdentity(general));
    expect(modelProbeIdentity(planner)).not.toBe(modelProbeIdentity(fallback));
  });

  it("distinguishes stale local references, qualification warnings, busy models, and missing roles", () => {
    const config = resolveResearchManagerConfig({
      models: [
        {
          id: "local-planner",
          provider: "ollama",
          model: "deleted:latest",
          roles: ["planner"],
          remote: false,
          memoryGb: 8,
          contextTokens: 64_000,
          maxParallel: 1,
          qualificationScore: 10,
          enabled: true,
          exclusive: false,
        },
      ],
    });
    const registry = new ModelCapabilityRegistry(config);
    registry.updateOllamaInventory({
      baseUrl: "http://127.0.0.1:11434",
      reachable: true,
      checkedAt: new Date().toISOString(),
      models: [],
      totalLoadedBytes: 0,
    });
    const models = registry
      .snapshot({ planner: 16_000 })
      .map((status) => Object.assign({}, status, { busy: true }));
    const result = assessDoctorReadiness({
      models,
      probes: [{ modelId: "local-planner", ok: false, durationMs: 1, error: "not found" }],
      webSearchProviders: [],
      certifiedRoles: new Set(),
    });
    expect(result.issues.join("\n")).toMatch(/not installed/);
    expect(result.issues.join("\n")).toMatch(/live probe failed: not found/);
    expect(result.issues.join("\n")).toMatch(/No web-search provider/);
    expect(result.issues.join("\n")).toMatch(/role planner/);
    expect(result.warnings.join("\n")).toMatch(/busy or queued/);
    expect(result.issues).toEqual(result.issues.toSorted());
  });

  it("fails readiness when registered web search cannot return a public result", () => {
    const result = assessDoctorReadiness({
      models: [],
      probes: [],
      webSearchProviders: ["duckduckgo"],
      webSearchProbe: {
        ok: false,
        provider: "duckduckgo",
        resultCount: 0,
        durationMs: 10,
        error: "provider returned no public HTTP results",
      },
      certifiedRoles: new Set(RESEARCH_MODEL_ROLES),
    });
    expect(result.issues).toContain(
      "Live web-search probe failed: provider returned no public HTTP results",
    );
  });

  it("keeps an installed but unqualified model as a warning while failing the uncovered role", () => {
    const config = resolveResearchManagerConfig({
      models: [
        {
          id: "local-scout",
          provider: "ollama",
          model: "scout:latest",
          roles: ["scout"],
          remote: false,
          memoryGb: 8,
          contextTokens: 32_000,
          maxParallel: 1,
          qualificationScore: 70,
          enabled: true,
          exclusive: false,
        },
      ],
    });
    const registry = new ModelCapabilityRegistry(config);
    registry.updateOllamaInventory({
      baseUrl: "http://127.0.0.1:11434",
      reachable: true,
      checkedAt: new Date().toISOString(),
      models: [
        {
          name: "scout:latest",
          model: "scout:latest",
          sizeBytes: 8,
          loaded: false,
        },
      ],
      totalLoadedBytes: 0,
    });
    const result = assessDoctorReadiness({
      models: registry.snapshot().map((status) => Object.assign({}, status, { busy: false })),
      probes: [],
      webSearchProviders: ["test"],
      certifiedRoles: new Set(),
    });
    expect(result.warnings.join("\n")).toMatch(/qualification 70 is below scout threshold 75/);
    expect(result.issues.join("\n")).toMatch(/role scout/);
    expect(result.issues.join("\n")).not.toMatch(/not installed/);
  });
});

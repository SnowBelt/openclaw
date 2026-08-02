import { describe, expect, it, vi } from "vitest";
import {
  cancelInterruptedAcceptanceReceipt,
  createSolOnlyConfig,
  finalizeAcceptanceReceipt,
  loadAcceptanceCorpus,
  runAcceptanceBenchmark,
  summarizeAcceptanceRun,
  type AcceptanceBenchmarkReceipt,
  type AcceptanceProfile,
  type AcceptanceTask,
} from "./acceptance.js";
import { resolveResearchManagerConfig } from "./config.js";
import type { ResearchManagerRuntime } from "./runtime.js";
import type { ResearchModelAttempt, ResearchRunReport, ResearchSource } from "./types.js";

function sourcesFor(task: AcceptanceTask): ResearchSource[] {
  const required = task.requiredDomainGroups.map((group) => group[0]);
  const domains = [
    ...required,
    ...Array.from({ length: 8 }, (_, index) => `source-${index}.example`),
  ]
    .filter((domain, index, values) => values.indexOf(domain) === index)
    .slice(0, Math.max(8, required.length));
  return domains.map((domain, index) => ({
    id: `S${index + 1}`,
    query: task.query,
    url: `https://${domain}/document-${index}`,
    domain,
    title: `Source ${index + 1}`,
    snippet: "Authoritative acceptance evidence.",
    content: "Authoritative acceptance evidence with enough text for verification.",
    retrievedAt: "2026-07-16T12:00:00.000Z",
    searchProvider: "acceptance-fixture",
    sourceType: index < required.length ? "primary" : "unknown",
    fetchStatus: "fetched",
    contentSha256: `${index}`.padStart(64, "0"),
  }));
}

function attempt(profile: AcceptanceProfile, index: number, local: boolean): ResearchModelAttempt {
  const now = "2026-07-16T12:00:00.000Z";
  return {
    id: `${profile}-${index}`,
    role: index === 0 ? "planner" : index === 1 ? "finalizer" : "researcher",
    modelId: local ? "local-qualified" : "sol-qualified",
    provider: local ? "ollama" : "openai",
    model: local ? "local" : "gpt-5.6-sol",
    startedAt: now,
    endedAt: now,
    status: "succeeded",
    local,
    reservedMemoryGb: local ? 8 : 0,
    tokenUsage: { input: local ? 80 : 75, output: local ? 20 : 25, total: 100 },
  };
}

function completedReport(params: {
  profile: AcceptanceProfile;
  task: AcceptanceTask;
  runId: string;
  score?: number;
}): ResearchRunReport {
  const baseline = params.profile === "sol-only";
  const attempts = baseline
    ? Array.from({ length: 6 }, (_, index) => attempt(params.profile, index, false))
    : [
        attempt(params.profile, 1, false),
        ...Array.from({ length: 4 }, (_, index) => attempt(params.profile, index + 2, true)),
      ];
  const localModelCalls = attempts.filter((entry) => entry.local).length;
  const remoteModelCalls = attempts.length - localModelCalls;
  const remoteTokens = attempts
    .filter((entry) => !entry.local)
    .reduce((sum, entry) => sum + (entry.tokenUsage?.total ?? 0), 0);
  const localTokens = attempts
    .filter((entry) => entry.local)
    .reduce((sum, entry) => sum + (entry.tokenUsage?.total ?? 0), 0);
  const now = "2026-07-16T12:05:00.000Z";
  const sources = sourcesFor(params.task);
  const requiredSourceCount = new Set(params.task.requiredDomainGroups.map((group) => group[0]))
    .size;
  const claims = sources.slice(0, requiredSourceCount).map((source, index) => ({
    id: `C${index + 1}`,
    questionId: `Q${index + 1}`,
    text: `Required primary-source fact ${index + 1}.`,
    sourceIds: [source.id],
    evidence: [
      {
        sourceId: source.id,
        quote: "Authoritative acceptance evidence",
        supports: true,
      },
    ],
    confidence: 1,
    material: true,
    status: "verified" as const,
  }));
  return {
    runId: params.runId,
    query: params.task.query,
    mode: "certified",
    status: "completed",
    answer: `${claims.map((claim) => `${claim.text} [${claim.sourceIds[0]}]`).join("\n")}\n\nSources`,
    usedClaimIds: claims.map((claim) => claim.id),
    limitations: [],
    plan: {
      objective: params.task.query,
      questions: claims.map((claim, index) => ({
        id: claim.questionId,
        question: `Required question ${index + 1}`,
        priority: "required" as const,
      })),
      queries: [
        {
          query: params.task.query,
          questionIds: claims.map((claim) => claim.questionId),
          preferredSourceTypes: ["primary"],
        },
      ],
      sourceRequirements: ["authoritative sources"],
      riskLevel: params.task.highStakes ? "high" : "normal",
      stopConditions: ["all required questions supported"],
    },
    sources,
    claims,
    findings: [],
    attempts,
    gaps: [],
    certification: {
      threshold: 93,
      score: params.score ?? (baseline ? 94 : 95),
      certified: true,
      hardGateFailures: [],
      dimensions: [],
      evaluatedAt: now,
    },
    createdAt: "2026-07-16T12:00:00.000Z",
    updatedAt: now,
    completedAt: now,
    repairPasses: 0,
    localModelCalls,
    remoteModelCalls,
    metrics: {
      wallTimeMs: 300_000,
      localCallShare: localModelCalls / attempts.length,
      fallbackCount: 0,
      tokenUsage: {
        local: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: localTokens,
        },
        remote: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: remoteTokens,
        },
      },
      costCoverage: "unavailable",
    },
  };
}

function memoryRuntime() {
  const receipts = new Map<string, AcceptanceBenchmarkReceipt>();
  const reports = new Map<string, ResearchRunReport>();
  const run = vi.fn();
  const store = {
    async create(report: ResearchRunReport) {
      if (reports.has(report.runId)) {
        throw new Error(`duplicate report ${report.runId}`);
      }
      reports.set(report.runId, structuredClone(report));
    },
    async save(report: ResearchRunReport) {
      reports.set(report.runId, structuredClone(report));
    },
    async load(runId: string) {
      const report = reports.get(runId);
      return report ? structuredClone(report) : undefined;
    },
    async saveAcceptance(receipt: AcceptanceBenchmarkReceipt) {
      receipts.set(receipt.receiptId, structuredClone(receipt));
    },
    async loadAcceptance(receiptId: string) {
      const receipt = receipts.get(receiptId);
      return receipt ? structuredClone(receipt) : undefined;
    },
  };
  return {
    runtime: { store, run } as unknown as Pick<ResearchManagerRuntime, "run" | "store">,
    run,
    receipts,
    reports,
  };
}

describe("Research Manager acceptance", () => {
  it("marks an interrupted running receipt resumable without changing terminal receipts", async () => {
    const hybrid = memoryRuntime();
    const solOnly = memoryRuntime();
    const receipt = await runAcceptanceBenchmark({
      hybridRuntime: hybrid.runtime,
      solOnlyRuntime: solOnly.runtime,
      taskIds: ["factual-sqlite-wal"],
      execute: async ({ profile, task, runId }) => completedReport({ profile, task, runId }),
    });
    const running = {
      ...receipt,
      status: "running" as const,
      completedAt: undefined,
    };
    const cancelled = cancelInterruptedAcceptanceReceipt(running, "2026-07-16T00:00:00.000Z");
    expect(cancelled).toMatchObject({
      status: "cancelled",
      completedAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z",
    });
    expect(cancelled.receiptSha256).not.toBe(running.receiptSha256);
    expect(cancelInterruptedAcceptanceReceipt(receipt)).toBe(receipt);
  });

  it("propagates cancellation and does not start the hybrid arm", async () => {
    const hybrid = memoryRuntime();
    const solOnly = memoryRuntime();
    const controller = new AbortController();
    const execute = vi.fn(async ({ profile, task, runId, signal }) => {
      expect(signal).toBe(controller.signal);
      controller.abort();
      return completedReport({ profile, task, runId });
    });
    const receipt = await runAcceptanceBenchmark({
      hybridRuntime: hybrid.runtime,
      solOnlyRuntime: solOnly.runtime,
      taskIds: ["factual-sqlite-wal"],
      signal: controller.signal,
      execute,
    });
    expect(receipt.status).toBe("cancelled");
    expect(receipt.completedAt).toBeDefined();
    expect(receipt.cases[0]?.baseline).toBeDefined();
    expect(receipt.cases[0]?.hybrid).toBeUndefined();
    expect(execute).toHaveBeenCalledOnce();
  });

  it("locks one task for every required category", async () => {
    const corpus = await loadAcceptanceCorpus();
    expect(corpus.tasks).toHaveLength(6);
    expect(new Set(corpus.tasks.map((task) => task.category))).toEqual(
      new Set(["factual", "comparative", "current", "adversarial", "ambiguous", "high-stakes"]),
    );
    expect(corpus.tasks.every((task) => task.minimumScore >= 93)).toBe(true);
    expect(corpus.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("builds a Sol-only profile with complete role coverage and no local models", () => {
    const config = createSolOnlyConfig(resolveResearchManagerConfig({}));
    expect(config.models.map((model) => model.id)).toEqual([
      "sol-planner-finalizer",
      "sol-general-fallback",
    ]);
    expect(config.models.every((model) => model.remote)).toBe(true);
    expect(config.models.every((model) => model.thinking === "max")).toBe(true);
    expect(new Set(config.models.flatMap((model) => model.roles))).toEqual(
      new Set(["planner", "scout", "researcher", "verifier", "critic", "finalizer"]),
    );
    expect(
      config.models.find((model) => model.id === "sol-general-fallback")?.qualificationScore,
    ).toBe(0);
  });

  it("persists a strict paired pass and reuses the terminal receipt without duplicate calls", async () => {
    const hybrid = memoryRuntime();
    const solOnly = memoryRuntime();
    const execute = vi.fn(async ({ profile, task, runId, sourceReport }) => {
      if (profile === "hybrid") {
        expect(sourceReport?.runId).toMatch(/^accept-/);
      } else {
        expect(sourceReport).toBeUndefined();
      }
      return completedReport({ profile, task, runId });
    });
    const receipt = await runAcceptanceBenchmark({
      hybridRuntime: hybrid.runtime,
      solOnlyRuntime: solOnly.runtime,
      execute,
    });
    expect(receipt.status).toBe("passed");
    expect(receipt.cases).toHaveLength(6);
    expect(
      receipt.cases.every((entry) => entry.passed && entry.nonInferior && entry.evidenceMatched),
    ).toBe(true);
    expect(receipt.aggregate).toMatchObject({
      baselineMeanScore: 94,
      hybridMeanScore: 95,
      qualityDelta: 1,
      hybridLocalCallShare: 0.6667,
      remoteTokenReduction: 0.6667,
      profileFailureRate: 0,
    });
    expect(receipt.gates?.every((gate) => gate.passed)).toBe(true);
    expect(receipt.receiptSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(execute).toHaveBeenCalledTimes(12);

    const resumed = await runAcceptanceBenchmark({
      hybridRuntime: hybrid.runtime,
      solOnlyRuntime: solOnly.runtime,
      receiptId: receipt.receiptId,
      execute,
    });
    expect(resumed).toEqual(receipt);
    expect(execute).toHaveBeenCalledTimes(12);
  });

  it("seeds the hybrid arm from the paired Sol-only plan and evidence corpus", async () => {
    const corpus = await loadAcceptanceCorpus();
    const task = corpus.tasks[0];
    expect(task).toBeDefined();
    if (!task) {
      return;
    }
    const hybrid = memoryRuntime();
    const solOnly = memoryRuntime();
    solOnly.run.mockImplementation(async (request: { runId: string }) => {
      const report = completedReport({
        profile: "sol-only",
        task,
        runId: request.runId,
      });
      solOnly.reports.set(report.runId, structuredClone(report));
      return report;
    });
    hybrid.run.mockImplementation(async (request: { runId: string }) => {
      const seed = await hybrid.runtime.store.load(request.runId);
      expect(seed?.replayedFromRunId).toMatch(/^accept-/);
      expect(seed?.plan).toEqual(
        [...solOnly.reports.values()].find((report) => report.runId === seed?.replayedFromRunId)
          ?.plan,
      );
      const report = completedReport({ profile: "hybrid", task, runId: request.runId });
      report.replayedFromRunId = seed?.replayedFromRunId;
      report.plan = seed?.plan;
      report.planProvenance = seed?.planProvenance;
      report.sources = structuredClone(seed?.sources ?? []);
      hybrid.reports.set(report.runId, structuredClone(report));
      return report;
    });

    const receipt = await runAcceptanceBenchmark({
      hybridRuntime: hybrid.runtime,
      solOnlyRuntime: solOnly.runtime,
      taskIds: [task.id],
    });

    expect(receipt.cases[0]?.baseline?.sharedSetupModelCalls).toBe(0);
    expect(receipt.cases[0]?.hybrid).toMatchObject({
      sharedSetupModelCalls: 1,
      sharedSetupRemoteTokens: 100,
    });
    expect(receipt.cases[0]?.evidenceMatched).toBe(true);
    expect(hybrid.run).toHaveBeenCalledOnce();
  });

  it("fails closed when paired profiles do not use identical fetched evidence", async () => {
    const hybrid = memoryRuntime();
    const solOnly = memoryRuntime();
    const receipt = await runAcceptanceBenchmark({
      hybridRuntime: hybrid.runtime,
      solOnlyRuntime: solOnly.runtime,
      execute: async ({ profile, task, runId }) => {
        const report = completedReport({ profile, task, runId });
        if (profile === "hybrid" && report.sources[0]) {
          report.sources[0].contentSha256 = "f".repeat(64);
        }
        return report;
      },
    });

    expect(receipt.status).toBe("failed");
    expect(receipt.gates?.find((gate) => gate.id === "paired-evidence")?.passed).toBe(false);
    expect(receipt.cases[0]?.evidenceMatched).toBe(false);
    expect(receipt.cases[0]?.passed).toBe(false);
  });

  it("fails the zero-margin non-inferiority gate when one hybrid score regresses", async () => {
    const hybrid = memoryRuntime();
    const solOnly = memoryRuntime();
    const receipt = await runAcceptanceBenchmark({
      hybridRuntime: hybrid.runtime,
      solOnlyRuntime: solOnly.runtime,
      execute: async ({ profile, task, runId }) =>
        completedReport({
          profile,
          task,
          runId,
          score: profile === "hybrid" && task.id === "factual-sqlite-wal" ? 93 : 94,
        }),
    });
    expect(receipt.status).toBe("failed");
    expect(receipt.gates?.find((gate) => gate.id === "paired-non-inferiority")?.passed).toBe(false);
    expect(receipt.cases.find((entry) => entry.taskId === "factual-sqlite-wal")?.passed).toBe(
      false,
    );

    const recomputed = finalizeAcceptanceReceipt(receipt);
    expect(recomputed.status).toBe("failed");
    expect(recomputed.receiptSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("requires every mandated domain to contribute fetched, verified evidence", async () => {
    const corpus = await loadAcceptanceCorpus();
    const task = corpus.tasks.find((entry) => entry.requiredDomainGroups.length > 1);
    expect(task).toBeDefined();
    if (!task) {
      return;
    }
    const report = completedReport({ profile: "hybrid", task, runId: "domain-proof" });
    const usedClaim = report.claims.find((claim) => claim.id === report.usedClaimIds?.at(-1));
    expect(usedClaim).toBeDefined();
    const source = report.sources.find((entry) => entry.id === usedClaim?.sourceIds[0]);
    expect(source).toBeDefined();
    if (source) {
      source.fetchStatus = "failed";
    }

    const result = summarizeAcceptanceRun({ profile: "hybrid", task, report });
    expect(result.requiredDomainsSatisfied).toBe(false);
    expect(result.missingDomainGroups).toHaveLength(1);
    expect(result.passed).toBe(false);
  });

  it("does not count a required-domain source that the verifier did not mark supporting", async () => {
    const corpus = await loadAcceptanceCorpus();
    const task = corpus.tasks.find((entry) => entry.requiredDomainGroups.length > 1);
    expect(task).toBeDefined();
    if (!task) {
      return;
    }
    const report = completedReport({ profile: "hybrid", task, runId: "support-proof" });
    const usedClaim = report.claims.find((claim) => claim.id === report.usedClaimIds?.at(-1));
    expect(usedClaim?.evidence[0]).toBeDefined();
    if (usedClaim?.evidence[0]) {
      usedClaim.evidence[0].supports = false;
    }

    const result = summarizeAcceptanceRun({ profile: "hybrid", task, report });
    expect(result.requiredDomainsSatisfied).toBe(false);
    expect(result.missingDomainGroups).toHaveLength(1);
    expect(result.passed).toBe(false);
  });
});

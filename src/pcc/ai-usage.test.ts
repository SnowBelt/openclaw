import { describe, expect, it } from "vitest";
import {
  pccModelRunReceiptId,
  recordPccModelRunReceipt,
  summarizePccProjectAiUsage,
} from "./ai-usage.js";
import type { PccLedger } from "./domain/ledger.js";

function ledger(): PccLedger {
  return {
    version: 1,
    projects: [
      {
        id: "project-1",
        title: "Project",
        status: "active",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    ],
    milestones: [],
    subMilestones: [],
    permissions: [],
    evidence: [],
    receipts: [],
    decisions: [],
    lastKnownGood: [],
    modelRunReceipts: [],
  };
}

describe("PCC AI usage receipts", () => {
  it("records a source run once and summarizes Codex separately from completion", () => {
    const state = ledger();
    const receipt = {
      projectId: "project-1",
      sourceRunId: "planning-run-1",
      executor: "codex" as const,
      purpose: "planning" as const,
      provider: "openai",
      model: "openai/gpt-5.6-sol",
      effort: "medium",
      status: "succeeded" as const,
      startedAt: "2026-08-01T00:00:00.000Z",
      completedAt: "2026-08-01T00:01:00.000Z",
      usage: { input: 20_000, output: 5_000, totalTokens: 25_000 },
      usageSource: "provider_reported" as const,
    };
    const first = recordPccModelRunReceipt(state, receipt);
    const second = recordPccModelRunReceipt(state, receipt);
    recordPccModelRunReceipt(state, {
      projectId: "project-1",
      sourceRunId: "local-run-1",
      executor: "local",
      purpose: "attachment_instruction_clarification",
      provider: "ollama",
      model: "qwen3.6:30b",
      status: "succeeded",
      startedAt: "2026-08-01T00:02:00.000Z",
      completedAt: "2026-08-01T00:02:05.000Z",
      usageSource: "unavailable",
    });

    expect(first).toBe(second);
    expect(state.modelRunReceipts).toHaveLength(2);
    expect(first.id).toBe(pccModelRunReceiptId("project-1", "planning-run-1"));
    expect(summarizePccProjectAiUsage(state, "project-1")).toEqual({
      attemptedRuns: 2,
      succeededRuns: 2,
      failedRuns: 0,
      cancelledRuns: 0,
      completedRuns: 2,
      codexRuns: 1,
      localRuns: 1,
      codexSharePercent: 50,
      reportedTokens: { total: 25_000, codex: 25_000, local: 0 },
      missingUsageRuns: 1,
      tokenCoverage: "partial",
      recordingStartedAt: "2026-08-01T00:00:00.000Z",
      byPurpose: [
        { purpose: "planning", runs: 1, codexRuns: 1, reportedTokens: 25_000 },
        {
          purpose: "attachment_instruction_clarification",
          runs: 1,
          codexRuns: 0,
          reportedTokens: 0,
        },
      ],
    });
  });

  it("keeps failed and cancelled attempts visible without calling them completed", () => {
    const state = ledger();
    for (const [sourceRunId, status] of [
      ["failed-run", "failed"],
      ["cancelled-run", "cancelled"],
    ] as const) {
      recordPccModelRunReceipt(state, {
        projectId: "project-1",
        sourceRunId,
        executor: "local",
        purpose: "implementation",
        provider: "ollama",
        model: "qwen",
        status,
        startedAt: "2026-08-01T00:00:00.000Z",
        completedAt: "2026-08-01T00:00:01.000Z",
        usageSource: "unavailable",
      });
    }
    expect(summarizePccProjectAiUsage(state, "project-1")).toMatchObject({
      attemptedRuns: 2,
      succeededRuns: 0,
      failedRuns: 1,
      cancelledRuns: 1,
      completedRuns: 0,
      localRuns: 2,
    });
  });

  it("fails closed when a receipt references an unknown project", () => {
    expect(() =>
      recordPccModelRunReceipt(ledger(), {
        projectId: "missing",
        sourceRunId: "run-1",
        executor: "local",
        purpose: "qa",
        provider: "ollama",
        model: "qwen",
        status: "succeeded",
        startedAt: "2026-08-01T00:00:00.000Z",
        completedAt: "2026-08-01T00:00:01.000Z",
        usageSource: "unavailable",
      }),
    ).toThrow("project not found");
  });

  it("does not double-count cached tokens when the provider omits a total", () => {
    const state = ledger();
    recordPccModelRunReceipt(state, {
      projectId: "project-1",
      sourceRunId: "run-with-cache",
      executor: "local",
      purpose: "qa",
      provider: "local",
      model: "qwen",
      status: "succeeded",
      startedAt: "2026-08-01T00:00:00.000Z",
      completedAt: "2026-08-01T00:00:01.000Z",
      usage: { input: 100, output: 20, cacheRead: 50 },
      usageSource: "provider_reported",
    });

    expect(summarizePccProjectAiUsage(state, "project-1").reportedTokens.total).toBe(120);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { onInternalDiagnosticEvent } from "../infra/diagnostic-events.js";
import {
  isSelfImprovementBackgroundEnabled,
  resolveAdaptiveSelfImprovementInterval,
  startSelfImprovementGovernorBackgroundTask,
} from "./background.js";
import type { SelfImprovementSignal } from "./signals.js";
import type { SelfImprovementAnalysisRunResult, SelfImprovementScanResult } from "./types.js";

const now = Date.parse("2026-05-07T12:00:00.000Z");

function scanResult(): SelfImprovementScanResult {
  return {
    scan: {
      scannedAt: now,
      trigger: "background",
      inspected: {
        tasks: 0,
        cronJobs: 0,
        auditEvents: 0,
        skillWorkshopProposals: 0,
        signals: 0,
      },
      produced: 0,
      created: 0,
      updated: 0,
      reopened: 0,
      total: 0,
      open: 0,
    },
    recommendations: [],
  };
}

function analysisResult(): SelfImprovementAnalysisRunResult {
  return {
    analyzedAt: now,
    mode: "deterministic",
    confidence: 0.8,
    reviewPolicy: "deterministic",
    promptVersion: "self-improvement-governor-analysis-v1",
    llmRequested: false,
    llmApproved: false,
    localFirst: false,
    hostedEscalationAllowed: false,
    strategicLocalAllowed: false,
    groupsAnalyzed: 0,
    groupsReviewedByLlm: 0,
    groupsReviewedByLocalLlm: 0,
    recommendationsUpdated: 0,
    proposalsCreated: 0,
    attempts: [],
    schemaValidated: false,
    scorecard: {
      generatedAt: now,
      totalRecommendations: 0,
      activeRecommendations: 0,
      groupedRecommendations: 0,
      criticalOpen: 0,
      highOpen: 0,
      testRequired: 0,
      approvalRequired: 0,
      reopenedLast24h: 0,
      resolvedLast24h: 0,
      byCategory: [],
      byRoute: [],
      needsApproval: [],
      whatImproved: [],
      whatWorsened: [],
    },
    proposals: [],
  };
}

describe("self-improvement background task", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps Gateway background mutation disabled unless explicitly enabled", () => {
    expect(isSelfImprovementBackgroundEnabled({})).toBe(false);
    expect(isSelfImprovementBackgroundEnabled({ OPENCLAW_SELF_IMPROVEMENT_BACKGROUND: "" })).toBe(
      false,
    );
    expect(
      isSelfImprovementBackgroundEnabled({ OPENCLAW_SELF_IMPROVEMENT_BACKGROUND: "invalid" }),
    ).toBe(false);
    expect(isSelfImprovementBackgroundEnabled({ OPENCLAW_SELF_IMPROVEMENT_BACKGROUND: "1" })).toBe(
      true,
    );
    expect(
      isSelfImprovementBackgroundEnabled({ OPENCLAW_SELF_IMPROVEMENT_BACKGROUND: "true" }),
    ).toBe(true);
  });

  it("backs off during quiet periods and accelerates for failures or new work", () => {
    const hour = 60 * 60_000;
    expect(
      resolveAdaptiveSelfImprovementInterval({
        baseIntervalMs: 6 * hour,
        quietCycles: 0,
        producedNewWork: true,
        failed: false,
      }),
    ).toBe(hour);
    expect(
      resolveAdaptiveSelfImprovementInterval({
        baseIntervalMs: 6 * hour,
        quietCycles: 2,
        producedNewWork: false,
        failed: false,
      }),
    ).toBe(24 * hour);
    expect(
      resolveAdaptiveSelfImprovementInterval({
        baseIntervalMs: 6 * hour,
        quietCycles: 2,
        producedNewWork: false,
        failed: true,
      }),
    ).toBe(30 * 60_000);
  });

  it("wakes promptly for a trusted high-severity typed signal", async () => {
    vi.useFakeTimers();
    let diagnosticListener: Parameters<typeof onInternalDiagnosticEvent>[0] | undefined;
    const triggers: string[] = [];
    const signal: SelfImprovementSignal = {
      id: "sis_wake",
      version: 1,
      idempotencyKey: "wake",
      source: { component: "test-component" },
      kind: "failure",
      severity: "high",
      summary: "A trusted failure needs prompt analysis.",
      firstSeenAt: 1,
      lastSeenAt: 1,
      occurrences: 1,
      evidenceRefs: [],
      privacy: "internal",
      trusted: true,
    };
    const task = startSelfImprovementGovernorBackgroundTask({
      getRuntimeConfig: () => ({}),
      intervalMs: 6 * 60 * 60_000,
      initialDelayMs: 6 * 60 * 60_000,
      signalWakeDelayMs: 100,
      recordOperationalHealth: false,
      subscribeDiagnosticEvents: (listener) => {
        diagnosticListener = listener;
        return () => {
          diagnosticListener = undefined;
        };
      },
      recordSignal: async () => ({ signal, created: true, duplicate: false, budgeted: false }),
      runScan: async ({ trigger }) => {
        triggers.push(trigger);
        return { ...scanResult(), scan: { ...scanResult().scan, trigger } };
      },
      runAnalysis: async () => analysisResult(),
    });

    try {
      diagnosticListener?.(
        {
          type: "improvement.signal",
          seq: 1,
          ts: 1,
          version: 1,
          idempotencyKey: "wake",
          source: { component: "test-component" },
          kind: "failure",
          severity: "high",
          summary: "A trusted failure needs prompt analysis.",
          privacy: "internal",
        },
        { trusted: true, internal: true },
      );
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(100);
    } finally {
      task.stop();
    }

    expect(triggers).toEqual(["signal"]);
  });

  it("runs deterministic analysis after each successful background scan", async () => {
    const cfg = {} as OpenClawConfig;
    const events: string[] = [];
    const task = startSelfImprovementGovernorBackgroundTask({
      getRuntimeConfig: () => cfg,
      intervalMs: 10_000,
      initialDelayMs: 10_000,
      recordOperationalHealth: false,
      runScan: async (params) => {
        expect(params).toMatchObject({
          cfg,
          trigger: "background",
        });
        events.push("scan");
        return scanResult();
      },
      runAnalysis: async (params) => {
        if (!params) {
          throw new Error("Expected self-improvement analysis params");
        }
        expect(params).toMatchObject({
          cfg,
          limit: 25,
          writeHealthSnapshot: false,
        });
        expect(params.llm).toBeUndefined();
        expect(params.localFirst).toBeUndefined();
        events.push("analysis");
        return analysisResult();
      },
    });

    try {
      await task.runNow();
    } finally {
      task.stop();
    }

    expect(events).toEqual(["scan", "analysis"]);
  });

  it("deduplicates concurrent background cycles", async () => {
    let releaseScan: (() => void) | null = null;
    const events: string[] = [];
    const task = startSelfImprovementGovernorBackgroundTask({
      getRuntimeConfig: () => ({}),
      intervalMs: 10_000,
      initialDelayMs: 10_000,
      recordOperationalHealth: false,
      runScan: async () => {
        events.push("scan");
        await new Promise<void>((resolve) => {
          releaseScan = resolve;
        });
        return scanResult();
      },
      runAnalysis: async () => {
        events.push("analysis");
        return analysisResult();
      },
    });

    try {
      const first = task.runNow();
      const second = task.runNow();
      const release = releaseScan as (() => void) | null;
      if (!release) {
        throw new Error("Expected background scan release callback");
      }
      release();
      await Promise.all([first, second]);
    } finally {
      task.stop();
    }

    expect(events).toEqual(["scan", "analysis"]);
  });

  it("floors too-small configured intervals before scheduling cycles", async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const task = startSelfImprovementGovernorBackgroundTask({
      getRuntimeConfig: () => ({}),
      initialDelayMs: 60 * 60_000,
      jitterRatio: 0,
      recordOperationalHealth: false,
      env: { OPENCLAW_SELF_IMPROVEMENT_INTERVAL_MS: "1" },
      runScan: async () => {
        events.push("scan");
        return scanResult();
      },
      runAnalysis: async () => {
        events.push("analysis");
        return analysisResult();
      },
    });

    try {
      await vi.advanceTimersByTimeAsync(14 * 60_000);
      expect(events).toEqual([]);
      await vi.advanceTimersByTimeAsync(60_000);
    } finally {
      task.stop();
    }

    expect(events).toEqual(["scan", "analysis"]);
  });

  it("records timeout failures without throwing from the scheduled runner", async () => {
    vi.useFakeTimers();
    const errors: string[] = [];
    const task = startSelfImprovementGovernorBackgroundTask({
      getRuntimeConfig: () => ({}),
      intervalMs: 10_000,
      initialDelayMs: 10_000,
      timeoutMs: 1_000,
      recordOperationalHealth: false,
      log: { error: (message) => errors.push(message) },
      runScan: async () => {
        await new Promise<void>(() => {});
        return scanResult();
      },
      runAnalysis: async () => analysisResult(),
    });

    try {
      const run = task.runNow();
      await vi.advanceTimersByTimeAsync(1_000);
      await run;
    } finally {
      task.stop();
    }

    expect(errors[0]).toContain("timed out after 1000ms");
  });

  it("can keep the legacy scan-only background behavior for tests or narrow operators", async () => {
    const events: string[] = [];
    const task = startSelfImprovementGovernorBackgroundTask({
      getRuntimeConfig: () => ({}),
      intervalMs: 10_000,
      initialDelayMs: 10_000,
      analyzeAfterScan: false,
      recordOperationalHealth: false,
      runScan: async () => {
        events.push("scan");
        return scanResult();
      },
      runAnalysis: async () => {
        events.push("analysis");
        return analysisResult();
      },
    });

    try {
      await task.runNow();
    } finally {
      task.stop();
    }

    expect(events).toEqual(["scan"]);
  });
});

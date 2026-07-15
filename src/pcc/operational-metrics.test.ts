import { describe, expect, it } from "vitest";
import type { PccEvidence } from "../../packages/gateway-protocol/src/schema/types.js";
import { PCC_OPERATIONAL_QUALITY_DIMENSIONS } from "./capability-contract.js";
import { buildPccOperationalMetrics } from "./operational-metrics.js";

function evidence(
  id: string,
  telemetry: Record<string, unknown>,
  quality?: Record<string, unknown>,
): PccEvidence {
  return {
    id,
    projectId: "project-1",
    milestoneId: "milestone-1",
    kind: "local_test",
    status: "passed",
    createdAt: `2026-07-13T00:00:0${id}.000Z`,
    metadata: {
      pccFirstPass: telemetry,
      ...(quality ? { pccQualityAssessment: quality } : {}),
    },
  };
}

function scores(value: number) {
  return Object.fromEntries(
    PCC_OPERATIONAL_QUALITY_DIMENSIONS.map((dimension) => [dimension, value]),
  );
}

describe("PCC operational metrics", () => {
  it("does not infer operational health when telemetry is absent", () => {
    expect(buildPccOperationalMetrics([])).toMatchObject({
      health: "no_data",
      sampleCount: 0,
      firstPassRate: null,
      qualityPassRate: null,
      latestEvidenceAt: null,
    });
  });

  it("reports a meeting 93-point local-first SLO from passed evidence", () => {
    const metrics = buildPccOperationalMetrics([
      evidence(
        "1",
        {
          attemptCount: 1,
          defectCount: 0,
          latencyMs: 500,
          costClass: "local",
          openAiApiUsed: false,
        },
        {
          assessor: "independent-local-qa",
          independent: true,
          criticalRegression: false,
          scores: scores(93),
        },
      ),
    ]);

    expect(metrics).toMatchObject({
      health: "meeting",
      firstPassRate: 100,
      errorBudgetRemaining: 100,
      localFirstRate: 100,
      qualityPassRate: 100,
      reworkAttempts: 0,
      defectCount: 0,
      averageLatencyMs: 500,
    });
  });

  it("exposes rework, defects, paid API use, and quality regressions", () => {
    const metrics = buildPccOperationalMetrics([
      evidence(
        "1",
        {
          attemptCount: 3,
          defectCount: 2,
          latencyMs: 1500,
          costClass: "metered",
          openAiApiUsed: true,
        },
        {
          assessor: "qa",
          independent: true,
          criticalRegression: true,
          scores: scores(92),
        },
      ),
    ]);

    expect(metrics).toMatchObject({
      health: "breached",
      firstPassRate: 0,
      errorBudgetRemaining: 0,
      localFirstRate: 0,
      qualityPassRate: 0,
      reworkAttempts: 2,
      defectCount: 2,
      criticalRegressionCount: 1,
      paidUseCount: 1,
      authorizedPaidUseCount: 0,
      unauthorizedPaidUseCount: 1,
    });
    expect(metrics.gaps).toHaveLength(3);
  });

  it("records approved paid API escalation without treating it as a policy breach", () => {
    const metrics = buildPccOperationalMetrics([
      evidence(
        "1",
        {
          attemptCount: 1,
          defectCount: 0,
          latencyMs: 750,
          costClass: "metered",
          openAiApiUsed: true,
          paidUseAuthorization: {
            permissionId: "permission-1",
            budgetId: "budget-1",
            reason: "Required capability was unavailable locally.",
          },
        },
        {
          assessor: "independent-local-qa",
          independent: true,
          criticalRegression: false,
          scores: scores(93),
        },
      ),
    ]);

    expect(metrics).toMatchObject({
      health: "meeting",
      localFirstRate: 0,
      paidUseCount: 1,
      authorizedPaidUseCount: 1,
      unauthorizedPaidUseCount: 0,
      gaps: [],
    });
  });
});

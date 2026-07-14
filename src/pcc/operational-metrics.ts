import type { PccEvidence } from "../../packages/gateway-protocol/src/schema/types.js";
import {
  PCC_OPERATIONAL_QUALITY_DIMENSIONS,
  PCC_OPERATIONAL_QUALITY_THRESHOLD,
} from "./capability-contract.js";
import {
  pccFirstPassTelemetryForEvidence,
  pccOperationalQualityAssessmentForEvidence,
} from "./capability-evidence.js";

export type PccOperationalHealth = "no_data" | "meeting" | "at_risk" | "breached";

export type PccOperationalMetrics = {
  target: number;
  health: PccOperationalHealth;
  sampleCount: number;
  firstPassSuccessCount: number;
  firstPassRate: number | null;
  errorBudgetRemaining: number | null;
  reworkAttempts: number;
  defectCount: number;
  averageLatencyMs: number | null;
  localFirstRate: number | null;
  paidUseCount: number;
  authorizedPaidUseCount: number;
  unauthorizedPaidUseCount: number;
  qualityAssessmentCount: number;
  qualityPassingCount: number;
  qualityPassRate: number | null;
  criticalRegressionCount: number;
  latestEvidenceAt: string | null;
  gaps: string[];
  source: "PCC passed evidence metadata";
};

function percent(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null;
}

export function buildPccOperationalMetrics(
  evidence: readonly PccEvidence[],
): PccOperationalMetrics {
  const passed = evidence.filter((entry) => entry.status === "passed");
  const firstPassSamples = passed.flatMap((entry) => {
    const telemetry = pccFirstPassTelemetryForEvidence(entry);
    return telemetry ? [{ entry, telemetry }] : [];
  });
  const assessments = passed.flatMap((entry) => {
    const assessment = pccOperationalQualityAssessmentForEvidence(entry);
    return assessment ? [{ entry, assessment }] : [];
  });
  const firstPassSuccessCount = firstPassSamples.filter(
    ({ telemetry }) => telemetry.attemptCount === 1 && telemetry.defectCount === 0,
  ).length;
  const firstPassRate = percent(firstPassSuccessCount, firstPassSamples.length);
  const localFirstCount = firstPassSamples.filter(
    ({ telemetry }) => !telemetry.openAiApiUsed,
  ).length;
  const localFirstRate = percent(localFirstCount, firstPassSamples.length);
  const paidUse = firstPassSamples.filter(({ telemetry }) => telemetry.openAiApiUsed);
  const authorizedPaidUseCount = paidUse.filter(
    ({ telemetry }) =>
      ["metered", "high"].includes(telemetry.costClass) && telemetry.paidUseAuthorization,
  ).length;
  const unauthorizedPaidUseCount = paidUse.length - authorizedPaidUseCount;
  const qualityPassingCount = assessments.filter(
    ({ assessment }) =>
      assessment.independent &&
      !assessment.criticalRegression &&
      PCC_OPERATIONAL_QUALITY_DIMENSIONS.every(
        (dimension) => assessment.scores[dimension] >= PCC_OPERATIONAL_QUALITY_THRESHOLD,
      ),
  ).length;
  const qualityPassRate = percent(qualityPassingCount, assessments.length);
  const criticalRegressionCount = assessments.filter(
    ({ assessment }) => assessment.criticalRegression,
  ).length;
  const failureRate = firstPassRate === null ? null : 100 - firstPassRate;
  const errorBudgetRemaining =
    failureRate === null
      ? null
      : Math.round(
          Math.max(0, 100 - (failureRate / (100 - PCC_OPERATIONAL_QUALITY_THRESHOLD)) * 100) * 10,
        ) / 10;
  const gaps: string[] = [];
  if (firstPassSamples.length === 0) {
    gaps.push("No first-pass telemetry has been recorded.");
  } else if ((firstPassRate ?? 0) < PCC_OPERATIONAL_QUALITY_THRESHOLD) {
    gaps.push(`First-pass success is below ${PCC_OPERATIONAL_QUALITY_THRESHOLD}%.`);
  }
  if (assessments.length === 0) {
    gaps.push("No independent operational quality assessment has been recorded.");
  } else if (qualityPassingCount < assessments.length) {
    gaps.push("One or more quality assessments failed the 93/100 no-regression gate.");
  }
  if (unauthorizedPaidUseCount > 0) {
    gaps.push("Evidence reports OpenAI API use without a complete permission and budget receipt.");
  }
  const health: PccOperationalHealth =
    firstPassSamples.length === 0 && assessments.length === 0
      ? "no_data"
      : criticalRegressionCount > 0 || unauthorizedPaidUseCount > 0
        ? "breached"
        : (firstPassRate !== null && firstPassRate < PCC_OPERATIONAL_QUALITY_THRESHOLD) ||
            qualityPassingCount < assessments.length
          ? "at_risk"
          : "meeting";
  const latestEvidenceAt =
    passed
      .map((entry) => entry.createdAt)
      .toSorted((left, right) => right.localeCompare(left))[0] ?? null;

  return {
    target: PCC_OPERATIONAL_QUALITY_THRESHOLD,
    health,
    sampleCount: firstPassSamples.length,
    firstPassSuccessCount,
    firstPassRate,
    errorBudgetRemaining,
    reworkAttempts: firstPassSamples.reduce(
      (total, { telemetry }) => total + Math.max(0, telemetry.attemptCount - 1),
      0,
    ),
    defectCount: firstPassSamples.reduce(
      (total, { telemetry }) => total + telemetry.defectCount,
      0,
    ),
    averageLatencyMs:
      firstPassSamples.length > 0
        ? Math.round(
            firstPassSamples.reduce((total, { telemetry }) => total + telemetry.latencyMs, 0) /
              firstPassSamples.length,
          )
        : null,
    localFirstRate,
    paidUseCount: paidUse.length,
    authorizedPaidUseCount,
    unauthorizedPaidUseCount,
    qualityAssessmentCount: assessments.length,
    qualityPassingCount,
    qualityPassRate,
    criticalRegressionCount,
    latestEvidenceAt,
    gaps,
    source: "PCC passed evidence metadata",
  };
}

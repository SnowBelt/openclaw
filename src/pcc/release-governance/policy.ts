import fs from "node:fs";
import path from "node:path";
import {
  RELEASE_GOVERNOR_POLICY_SCHEMA,
  type ReleaseGovernorPolicy,
  type ReleaseOperation,
  type ReleaseRiskLevel,
} from "./contracts.js";

const OPERATIONS: ReleaseOperation[] = ["stage", "promotion", "restart", "rollback", "finalize"];
const RISKS = new Set<ReleaseRiskLevel>(["P0", "P1", "P2", "P3"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.trim())
    ? value
    : null;
}

export function parseReleaseGovernorPolicy(value: unknown): ReleaseGovernorPolicy | null {
  if (!isRecord(value) || value.schema !== RELEASE_GOVERNOR_POLICY_SCHEMA) {
    return null;
  }
  if (
    !Number.isInteger(value.version) ||
    (value.version as number) < 1 ||
    !finiteNumber(value.confidenceThreshold) ||
    value.confidenceThreshold < 0 ||
    value.confidenceThreshold > 1 ||
    !finiteNumber(value.reviewConfidenceThreshold) ||
    value.reviewConfidenceThreshold < 0 ||
    value.reviewConfidenceThreshold > 1 ||
    !Array.isArray(value.classificationRules) ||
    !Array.isArray(value.protectedPaths) ||
    !isRecord(value.requiredChecks) ||
    !isRecord(value.healthThresholds)
  ) {
    return null;
  }
  const classificationRules = value.classificationRules.flatMap((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.pattern !== "string" ||
      !entry.pattern ||
      typeof entry.category !== "string" ||
      !entry.category ||
      !RISKS.has(entry.risk as ReleaseRiskLevel)
    ) {
      return [];
    }
    return [
      {
        pattern: entry.pattern,
        category: entry.category,
        risk: entry.risk as ReleaseRiskLevel,
      },
    ];
  });
  const protectedPaths = value.protectedPaths.flatMap((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.pattern !== "string" ||
      !entry.pattern ||
      typeof entry.reason !== "string" ||
      !entry.reason
    ) {
      return [];
    }
    return [{ pattern: entry.pattern, reason: entry.reason }];
  });
  if (
    classificationRules.length !== value.classificationRules.length ||
    protectedPaths.length !== value.protectedPaths.length
  ) {
    return null;
  }
  const requiredChecks = {} as Record<ReleaseOperation, string[]>;
  for (const operation of OPERATIONS) {
    const checks = stringArray(value.requiredChecks[operation]);
    if (!checks || new Set(checks).size !== checks.length) {
      return null;
    }
    requiredChecks[operation] = checks;
  }
  const thresholds = value.healthThresholds;
  if (
    !finiteNumber(thresholds.maxRouteLatencyMs) ||
    !finiteNumber(thresholds.maxErrorRate) ||
    !finiteNumber(thresholds.maxStartupFailures) ||
    !finiteNumber(thresholds.maxBrowserErrors)
  ) {
    return null;
  }
  return {
    schema: RELEASE_GOVERNOR_POLICY_SCHEMA,
    version: value.version as number,
    confidenceThreshold: value.confidenceThreshold,
    reviewConfidenceThreshold: value.reviewConfidenceThreshold,
    classificationRules,
    protectedPaths,
    requiredChecks,
    healthThresholds: {
      maxRouteLatencyMs: thresholds.maxRouteLatencyMs,
      maxErrorRate: thresholds.maxErrorRate,
      maxStartupFailures: thresholds.maxStartupFailures,
      maxBrowserErrors: thresholds.maxBrowserErrors,
    },
  };
}

export function readReleaseGovernorPolicy(
  policyPath = path.join(process.cwd(), "config", "release-governor-policy.json"),
): ReleaseGovernorPolicy {
  const parsed = parseReleaseGovernorPolicy(JSON.parse(fs.readFileSync(policyPath, "utf8")));
  if (!parsed) {
    throw new Error(`Release Governor policy is invalid: ${policyPath}`);
  }
  return parsed;
}

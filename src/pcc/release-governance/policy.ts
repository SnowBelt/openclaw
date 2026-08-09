import fs from "node:fs";
import path from "node:path";
import {
  RELEASE_GOVERNOR_POLICY_SCHEMA,
  type ReleaseGovernorPolicy,
  type ReleaseOperation,
  type ReleaseProofProfile,
  type ReleaseRiskLevel,
} from "./contracts.js";

const OPERATIONS: ReleaseOperation[] = ["stage", "promotion", "restart", "rollback", "finalize"];
const RELEASE_GOVERNOR_POLICY_VERSION = 3;
const MAC_STUDIO_CONTROL_DIRECTOR_PROFILE_VERSION = 2;
const RISKS = new Set<ReleaseRiskLevel>(["P0", "P1", "P2", "P3"]);
const CUSTOM_PROOF_PROFILES = new Set<Exclude<ReleaseProofProfile, "default">>([
  "mac_studio_control_director",
]);

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
    value.version !== RELEASE_GOVERNOR_POLICY_VERSION ||
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
  const proofProfiles: ReleaseGovernorPolicy["proofProfiles"] = {};
  const rawProofProfiles = value.proofProfiles ?? {};
  if (!isRecord(rawProofProfiles)) {
    return null;
  }
  for (const [profileName, rawProfile] of Object.entries(rawProofProfiles)) {
    if (
      !CUSTOM_PROOF_PROFILES.has(profileName as Exclude<ReleaseProofProfile, "default">) ||
      !isRecord(rawProfile) ||
      rawProfile.version !== MAC_STUDIO_CONTROL_DIRECTOR_PROFILE_VERSION ||
      rawProfile.project !== "project-command-center" ||
      rawProfile.destination !== "local-only" ||
      rawProfile.externalDisclosure !== false ||
      !isRecord(rawProfile.requiredChecks)
    ) {
      return null;
    }
    const prohibitedChecks = stringArray(rawProfile.prohibitedChecks);
    if (!prohibitedChecks || new Set(prohibitedChecks).size !== prohibitedChecks.length) {
      return null;
    }
    const profileRequiredChecks = {} as Record<ReleaseOperation, string[]>;
    for (const operation of OPERATIONS) {
      const checks = stringArray(rawProfile.requiredChecks[operation]);
      if (!checks || new Set(checks).size !== checks.length) {
        return null;
      }
      if (checks.some((check) => prohibitedChecks.includes(check))) {
        return null;
      }
      profileRequiredChecks[operation] = checks;
    }
    proofProfiles[profileName as Exclude<ReleaseProofProfile, "default">] = {
      version: MAC_STUDIO_CONTROL_DIRECTOR_PROFILE_VERSION,
      project: rawProfile.project,
      destination: rawProfile.destination,
      externalDisclosure: false,
      prohibitedChecks,
      requiredChecks: profileRequiredChecks,
    };
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
    proofProfiles,
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

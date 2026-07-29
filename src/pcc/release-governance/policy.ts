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
const RISKS = new Set<ReleaseRiskLevel>(["P0", "P1", "P2", "P3"]);
const CONFIGURABLE_PROOF_PROFILES = new Set<Exclude<ReleaseProofProfile, "standard">>([
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
    !isRecord(value.proofProfiles) ||
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
  for (const [profile, rawProfile] of Object.entries(value.proofProfiles)) {
    if (
      !CONFIGURABLE_PROOF_PROFILES.has(profile as Exclude<ReleaseProofProfile, "standard">) ||
      !isRecord(rawProfile) ||
      typeof rawProfile.description !== "string" ||
      !rawProfile.description.trim() ||
      !isRecord(rawProfile.requiredChecks)
    ) {
      return null;
    }
    const profileChecks = {} as Record<ReleaseOperation, string[]>;
    for (const operation of OPERATIONS) {
      const checks = stringArray(rawProfile.requiredChecks[operation]);
      if (!checks || new Set(checks).size !== checks.length) {
        return null;
      }
      profileChecks[operation] = checks;
    }
    proofProfiles[profile as Exclude<ReleaseProofProfile, "standard">] = {
      description: rawProfile.description,
      requiredChecks: profileChecks,
    };
  }
  if (!proofProfiles.mac_studio_control_director) {
    return null;
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

export function requiredReleaseChecksForProfile(params: {
  policy: ReleaseGovernorPolicy;
  operation: ReleaseOperation;
  profile: ReleaseProofProfile;
}): string[] {
  if (params.profile === "standard") {
    return [...params.policy.requiredChecks[params.operation]];
  }
  const configured = params.policy.proofProfiles[params.profile];
  if (!configured) {
    throw new Error(`Release proof profile is not configured: ${params.profile}.`);
  }
  return [...configured.requiredChecks[params.operation]];
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

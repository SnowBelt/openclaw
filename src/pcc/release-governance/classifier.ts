import type {
  ReleaseCandidateFacts,
  ReleaseCapabilityDiffEntry,
  ReleaseChangeClassification,
  ReleaseGovernorPolicy,
  ReleaseProtectedPathFinding,
  ReleaseRiskLevel,
} from "./contracts.js";

const RISK_SCORE: Record<ReleaseRiskLevel, number> = { P0: 4, P1: 3, P2: 2, P3: 1 };
const GIT_OBJECT_ID = /^[a-f0-9]{40,64}$/iu;

function normalizePath(value: string): string {
  return value
    .replaceAll("\\", "/")
    .replace(/^\.\//u, "")
    .replace(/\/{2,}/gu, "/");
}

export function validateReleaseCandidateFacts(facts: ReleaseCandidateFacts): string[] {
  const errors: string[] = [];
  for (const [name, value] of [
    ["project", facts.project],
    ["branch", facts.branch],
    ["repository", facts.repository],
  ] as const) {
    if (typeof value !== "string" || !value.trim()) {
      errors.push(`Release candidate ${name} is missing.`);
    }
  }
  if (!GIT_OBJECT_ID.test(facts.candidateSha)) {
    errors.push("Release candidate SHA must be a 40-64 character hexadecimal object ID.");
  }
  if (!GIT_OBJECT_ID.test(facts.parentSha)) {
    errors.push("Release parent SHA must be a 40-64 character hexadecimal object ID.");
  }
  if (facts.candidateSha === facts.parentSha) {
    errors.push("Release candidate SHA must differ from its parent SHA.");
  }
  if (
    !Array.isArray(facts.changedFiles) ||
    facts.changedFiles.some(
      (file) => typeof file !== "string" || !file.trim() || pathIsUnsafe(file),
    )
  ) {
    errors.push("Release changed files must be non-empty repository-relative paths.");
  }
  if (
    !Array.isArray(facts.ancestorShas) ||
    facts.ancestorShas.some((sha) => typeof sha !== "string" || !GIT_OBJECT_ID.test(sha)) ||
    !facts.ancestorShas.includes(facts.parentSha)
  ) {
    errors.push("Release ancestors must contain the exact parent SHA and valid object IDs.");
  }
  if (!Number.isInteger(facts.descendantDepth) || facts.descendantDepth < 0) {
    errors.push("Release descendant depth must be a non-negative integer.");
  }
  if (!Number.isInteger(facts.commitCount) || facts.commitCount < 1) {
    errors.push("Release commit count must be a positive integer.");
  }
  if (typeof facts.externalDisclosure !== "boolean") {
    errors.push("Release external-disclosure status must be explicit.");
  }
  if (
    facts.destination !== null &&
    (typeof facts.destination !== "string" || !facts.destination.trim())
  ) {
    errors.push("Release destination must be null or a non-empty string.");
  }
  if (typeof facts.scopeCoordinationMaterial !== "boolean") {
    errors.push("Release scope-coordination status must be explicit.");
  }
  return errors;
}

function pathIsUnsafe(value: string): boolean {
  const normalized = value.replaceAll("\\", "/");
  return normalized.startsWith("/") || normalized.split("/").some((segment) => segment === "..");
}

function globRegex(pattern: string): RegExp {
  const normalized = normalizePath(pattern);
  let source = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char === "*" && normalized[index + 1] === "*") {
      source += ".*";
      index += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    }
  }
  return new RegExp(`^${source}$`, "iu");
}

export function releasePathMatches(pattern: string, candidate: string): boolean {
  return globRegex(pattern).test(normalizePath(candidate));
}

export function classifyReleaseCandidate(params: {
  policy: ReleaseGovernorPolicy;
  facts: ReleaseCandidateFacts;
  capabilityDiff: ReleaseCapabilityDiffEntry[];
  operation: keyof ReleaseGovernorPolicy["requiredChecks"];
}): ReleaseChangeClassification {
  const destination = params.facts.destination?.trim() || null;
  const externalDisclosure =
    params.facts.externalDisclosure ||
    (destination !== null && !["local-only", "local-only runtime state"].includes(destination));
  const changedFiles = [...new Set(params.facts.changedFiles.map(normalizePath))].toSorted();
  const categories = new Set<string>();
  const risks: ReleaseRiskLevel[] = [];
  const unmatched: string[] = [];
  for (const file of changedFiles) {
    const matches = params.policy.classificationRules.filter((rule) =>
      releasePathMatches(rule.pattern, file),
    );
    if (matches.length === 0) {
      unmatched.push(file);
      continue;
    }
    for (const match of matches) {
      categories.add(match.category);
      risks.push(match.risk);
    }
  }
  const protectedPaths: ReleaseProtectedPathFinding[] = [];
  for (const file of changedFiles) {
    for (const rule of params.policy.protectedPaths) {
      if (releasePathMatches(rule.pattern, file)) {
        protectedPaths.push({ path: file, pattern: rule.pattern, reason: rule.reason });
      }
    }
  }
  const ambiguity = changedFiles.length === 0 || unmatched.length > 0;
  if (ambiguity) {
    categories.add("unknown");
    risks.push("P1");
  }
  const riskLevel =
    risks.toSorted((left, right) => RISK_SCORE[right] - RISK_SCORE[left])[0] ?? "P1";
  const capabilityBlocked = params.capabilityDiff.some(
    (entry) => entry.required && ["removed", "weakened", "unknown"].includes(entry.change),
  );
  const confidence = ambiguity ? 0.5 : 1;
  const belowConfidenceThreshold = confidence < params.policy.confidenceThreshold;
  const approvalRequired =
    riskLevel === "P0" ||
    riskLevel === "P1" ||
    protectedPaths.length > 0 ||
    capabilityBlocked ||
    externalDisclosure ||
    ambiguity ||
    belowConfidenceThreshold;
  const explanation = [
    `Highest deterministic risk is ${riskLevel}.`,
    ...(protectedPaths.length > 0
      ? [`${protectedPaths.length} protected path finding(s) require explicit approval.`]
      : ["No protected path was matched."]),
    ...(unmatched.length > 0
      ? [`Unclassified paths require escalation: ${unmatched.join(", ")}.`]
      : []),
    ...(capabilityBlocked ? ["A required capability is removed, weakened, or unknown."] : []),
    ...(externalDisclosure
      ? [`Candidate disclosure targets ${destination ?? "an unspecified destination"}.`]
      : []),
    ...(belowConfidenceThreshold
      ? [
          `Classification confidence ${confidence} is below the policy threshold ${params.policy.confidenceThreshold}.`,
        ]
      : []),
  ];
  return {
    candidateSha: params.facts.candidateSha,
    parentSha: params.facts.parentSha,
    changedFiles,
    semanticCategories: [...categories].toSorted(),
    protectedPaths,
    capabilityDiff: params.capabilityDiff,
    riskLevel,
    externalDisclosure,
    externalDestination: destination,
    requiredChecks: [...params.policy.requiredChecks[params.operation]],
    approvalRequired,
    ambiguous: ambiguity,
    explanation,
    confidence,
    policyVersion: params.policy.version,
  };
}

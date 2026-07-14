export const PCC_LEARNING_CANDIDATES_METADATA_KEY = "pccLearningCandidates" as const;

const PCC_LEARNING_CANDIDATE_VERSION = 1;
const LEGACY_LEARNING_METRIC_NAMES = [
  "speed",
  "accuracy",
  "efficiency",
  "first_pass_quality",
  "overall_quality",
] as const;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function repairLegacyMetrics(value: unknown): Record<string, unknown> | null {
  const source = record(value);
  if (
    typeof source.qa === "number" &&
    Number.isFinite(source.qa) &&
    source.qa >= 0 &&
    source.qa <= 100
  ) {
    return null;
  }
  if (
    source.qa !== undefined ||
    !LEGACY_LEARNING_METRIC_NAMES.every((name) => {
      const score = source[name];
      return typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 100;
    })
  ) {
    return null;
  }
  return { ...source, qa: 0 };
}

export function repairPccLearningCandidatesMetadata(
  metadata: unknown,
  now: string,
): { metadata: Record<string, unknown>; repairedCount: number } {
  const source = record(metadata);
  const raw = source[PCC_LEARNING_CANDIDATES_METADATA_KEY];
  if (!Array.isArray(raw)) {
    return { metadata: { ...source }, repairedCount: 0 };
  }
  let repairedCount = 0;
  const candidates = raw.map((value) => {
    const candidateSource = record(value);
    if (candidateSource.version !== PCC_LEARNING_CANDIDATE_VERSION) {
      return value;
    }
    const baselineMetrics = repairLegacyMetrics(candidateSource.baselineMetrics);
    const afterMetrics = repairLegacyMetrics(candidateSource.afterMetrics);
    if (!baselineMetrics && !afterMetrics) {
      return value;
    }
    repairedCount += 1;
    const requiresRetrial = candidateSource.status === "promoted";
    const repaired = Object.assign({}, candidateSource);
    if (baselineMetrics) {
      repaired.baselineMetrics = baselineMetrics;
    }
    if (afterMetrics) {
      repaired.afterMetrics = afterMetrics;
    }
    if (requiresRetrial) {
      repaired.status = "trial";
      repaired.statusReason =
        "Legacy promotion requires QA revalidation under the 93/100 quality contract.";
    }
    repaired.updatedAt = now;
    return repaired;
  });
  if (repairedCount === 0) {
    return { metadata: { ...source }, repairedCount: 0 };
  }
  return {
    metadata: {
      ...source,
      [PCC_LEARNING_CANDIDATES_METADATA_KEY]: candidates,
      pccLearningCandidatesCanonicalizedAt: now,
    },
    repairedCount,
  };
}

export const SELF_IMPROVEMENT_ACCEPTANCE_QUALITY_TARGET = 93;
export const SELF_IMPROVEMENT_ACCEPTANCE_SAFETY_FLOOR = 100;
export const SELF_IMPROVEMENT_PRODUCTION_SOAK_MS = 72 * 60 * 60_000;

export const SELF_IMPROVEMENT_ACCEPTANCE_SURFACES = [
  "source",
  "targeted_tests",
  "changed_gate",
  "build",
  "managed_runtime",
  "rpc",
  "dashboard",
] as const;

export type SelfImprovementAcceptanceSurface =
  (typeof SELF_IMPROVEMENT_ACCEPTANCE_SURFACES)[number];

export type SelfImprovementAcceptanceSurfaceReceipt = {
  surface: SelfImprovementAcceptanceSurface;
  status: "passed" | "failed";
  observedAt: number;
  evidence: string[];
};

export type SelfImprovementSoakSample = {
  observedAt: number;
  runtimeReleaseId: string;
  productionReady: boolean;
  productionScore: number;
  blockers: string[];
  rpcReady: boolean;
  dashboardReady: boolean;
  safetyViolations: number;
};

export type SelfImprovementSoakInput = {
  candidateReleaseId: string;
  startedAt: number;
  checkedAt: number;
  samples: SelfImprovementSoakSample[];
  managedRestartReleaseIds: string[];
  rollbackVerified: boolean;
};

export type SelfImprovementSoakEvaluation = {
  status: "pending" | "failed" | "passed";
  elapsedMs: number;
  sampleCount: number;
  distributedSampleCount: number;
  blockers: string[];
};

export type SelfImprovementFinalAcceptance = {
  complete: boolean;
  qualityScore: number;
  safetyScore: number;
  surfaces: Record<SelfImprovementAcceptanceSurface | "soak", boolean>;
  soak: SelfImprovementSoakEvaluation;
  blockers: string[];
};

function finiteTimestamp(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function boundedScore(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;
}

export function evaluateSelfImprovementProductionSoak(
  input: SelfImprovementSoakInput,
  options?: {
    minimumDurationMs?: number;
    minimumSamples?: number;
    minimumSampleSeparationMs?: number;
    maximumSampleGapMs?: number;
    qualityTarget?: number;
    requiredManagedRestarts?: number;
  },
): SelfImprovementSoakEvaluation {
  const minimumDurationMs = Math.max(
    1,
    Math.floor(options?.minimumDurationMs ?? SELF_IMPROVEMENT_PRODUCTION_SOAK_MS),
  );
  const minimumSamples = Math.max(2, Math.floor(options?.minimumSamples ?? 13));
  const minimumSampleSeparationMs = Math.max(
    1,
    Math.floor(options?.minimumSampleSeparationMs ?? 4 * 60 * 60_000),
  );
  const maximumSampleGapMs = Math.max(
    1,
    Math.floor(options?.maximumSampleGapMs ?? 12 * 60 * 60_000),
  );
  const qualityTarget = boundedScore(
    options?.qualityTarget ?? SELF_IMPROVEMENT_ACCEPTANCE_QUALITY_TARGET,
  );
  const requiredManagedRestarts = Math.max(0, Math.floor(options?.requiredManagedRestarts ?? 2));
  const elapsedMs = Math.max(0, input.checkedAt - input.startedAt);
  const samples = input.samples.toSorted(
    (left, right) =>
      left.observedAt - right.observedAt ||
      left.runtimeReleaseId.localeCompare(right.runtimeReleaseId),
  );
  const blockers: string[] = [];
  const distributedSamples = samples.reduce<SelfImprovementSoakSample[]>((accepted, sample) => {
    const previous = accepted.at(-1);
    if (!previous || sample.observedAt - previous.observedAt >= minimumSampleSeparationMs) {
      accepted.push(sample);
    }
    return accepted;
  }, []);
  if (!input.candidateReleaseId.trim()) {
    blockers.push("Candidate runtime release id is required.");
  }
  if (!finiteTimestamp(input.startedAt) || !finiteTimestamp(input.checkedAt)) {
    blockers.push("Soak timestamps must be non-negative safe integers.");
  }
  if (input.checkedAt < input.startedAt) {
    blockers.push("Soak check time precedes its start time.");
  }
  if (samples.some((sample) => !finiteTimestamp(sample.observedAt))) {
    blockers.push("Every soak sample needs a valid observation timestamp.");
  }
  if (
    samples.some(
      (sample) => sample.observedAt < input.startedAt || sample.observedAt > input.checkedAt,
    )
  ) {
    blockers.push("Every soak sample must fall inside the declared observation window.");
  }
  if (samples.some((sample) => sample.runtimeReleaseId !== input.candidateReleaseId)) {
    blockers.push("A soak sample came from a different runtime release.");
  }
  if (
    samples.some(
      (sample) =>
        !sample.productionReady ||
        !sample.rpcReady ||
        !sample.dashboardReady ||
        sample.blockers.length > 0,
    )
  ) {
    blockers.push("At least one soak sample failed production, RPC, dashboard, or blocker checks.");
  }
  if (samples.some((sample) => boundedScore(sample.productionScore) < qualityTarget)) {
    blockers.push(`At least one soak sample is below the ${qualityTarget} quality target.`);
  }
  if (samples.some((sample) => sample.safetyViolations !== 0)) {
    blockers.push("At least one soak sample reported a safety-boundary violation.");
  }
  const candidateRestarts = input.managedRestartReleaseIds.filter(
    (releaseId) => releaseId === input.candidateReleaseId,
  ).length;
  if (candidateRestarts < requiredManagedRestarts) {
    blockers.push(
      `Soak requires ${requiredManagedRestarts} managed candidate restart(s); observed ${candidateRestarts}.`,
    );
  }
  if (!input.rollbackVerified) {
    blockers.push("Candidate rollback has not been verified.");
  }
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    if (previous && current && current.observedAt - previous.observedAt > maximumSampleGapMs) {
      blockers.push("Soak sample cadence exceeded the maximum allowed gap.");
      break;
    }
  }
  const firstSample = samples[0];
  if (firstSample && firstSample.observedAt - input.startedAt > maximumSampleGapMs) {
    blockers.push("The first soak sample was collected after the maximum allowed startup gap.");
  }
  const latestSample = samples.at(-1);
  if (
    elapsedMs >= minimumDurationMs &&
    latestSample &&
    input.checkedAt - latestSample.observedAt > maximumSampleGapMs
  ) {
    blockers.push("The latest soak sample is older than the maximum allowed completion gap.");
  }

  const hardFailure = blockers.some(
    (blocker) =>
      !blocker.startsWith("Soak requires") &&
      blocker !== "Candidate rollback has not been verified.",
  );
  if (hardFailure) {
    return {
      status: "failed",
      elapsedMs,
      sampleCount: samples.length,
      distributedSampleCount: distributedSamples.length,
      blockers,
    };
  }
  if (elapsedMs < minimumDurationMs) {
    blockers.push(`Soak has not reached the required ${minimumDurationMs}ms duration.`);
  }
  if (distributedSamples.length < minimumSamples) {
    blockers.push(
      `Soak requires ${minimumSamples} distributed samples; observed ${distributedSamples.length}.`,
    );
  }
  return {
    status: blockers.length === 0 ? "passed" : "pending",
    elapsedMs,
    sampleCount: samples.length,
    distributedSampleCount: distributedSamples.length,
    blockers,
  };
}

export function evaluateSelfImprovementFinalAcceptance(params: {
  receipts: readonly SelfImprovementAcceptanceSurfaceReceipt[];
  qualityScore: number;
  safetyScore: number;
  soak: SelfImprovementSoakInput;
}): SelfImprovementFinalAcceptance {
  const qualityScore = boundedScore(params.qualityScore);
  const safetyScore = boundedScore(params.safetyScore);
  const receiptBySurface = new Map(
    params.receipts.map((receipt) => [receipt.surface, receipt] as const),
  );
  const surfaces = Object.fromEntries(
    SELF_IMPROVEMENT_ACCEPTANCE_SURFACES.map((surface) => {
      const receipt = receiptBySurface.get(surface);
      return [
        surface,
        receipt?.status === "passed" &&
          finiteTimestamp(receipt.observedAt) &&
          receipt.evidence.some((entry) => entry.trim().length > 0),
      ];
    }),
  ) as Record<SelfImprovementAcceptanceSurface, boolean>;
  const soak = evaluateSelfImprovementProductionSoak(params.soak);
  const allSurfacesPassed = Object.values(surfaces).every(Boolean);
  const blockers = [
    ...SELF_IMPROVEMENT_ACCEPTANCE_SURFACES.filter((surface) => !surfaces[surface]).map(
      (surface) => `Acceptance surface ${surface} lacks a passing evidence receipt.`,
    ),
    qualityScore < SELF_IMPROVEMENT_ACCEPTANCE_QUALITY_TARGET
      ? `Quality score ${qualityScore} is below ${SELF_IMPROVEMENT_ACCEPTANCE_QUALITY_TARGET}.`
      : "",
    safetyScore !== SELF_IMPROVEMENT_ACCEPTANCE_SAFETY_FLOOR
      ? `Safety score ${safetyScore} must equal ${SELF_IMPROVEMENT_ACCEPTANCE_SAFETY_FLOOR}.`
      : "",
    ...soak.blockers,
  ].filter(Boolean);
  return {
    complete:
      allSurfacesPassed &&
      qualityScore >= SELF_IMPROVEMENT_ACCEPTANCE_QUALITY_TARGET &&
      safetyScore === SELF_IMPROVEMENT_ACCEPTANCE_SAFETY_FLOOR &&
      soak.status === "passed",
    qualityScore,
    safetyScore,
    surfaces: { ...surfaces, soak: soak.status === "passed" },
    soak,
    blockers,
  };
}

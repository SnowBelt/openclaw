import type { SelfImprovementOutboxItem } from "./outbox.js";
import type { SelfImprovementSignal } from "./signals.js";
import type {
  SelfImprovementOperationalHealthDimension,
  SelfImprovementRecommendation,
} from "./types.js";

const TARGET_SCORE = 93;
const SIGNAL_COVERAGE_TARGET = 95;
const DUPLICATE_RATE_MAX = 5;
const ROUTING_ACCURACY_TARGET = 93;
const PROOF_CLOSURE_TARGET = 93;
const DETECTION_P95_TARGET_MS = 60_000;

function boundedPercent(numerator: number, denominator: number, empty = 100): number {
  if (denominator <= 0) {
    return empty;
  }
  return Math.max(0, Math.min(100, Math.round((numerator / denominator) * 100)));
}

function percentile95(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].toSorted((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

function signalIdFromRecommendation(
  recommendation: SelfImprovementRecommendation,
): string | undefined {
  const runId = recommendation.source.runId;
  return runId?.startsWith("signal:") ? runId.slice("signal:".length) || undefined : undefined;
}

function weightedScore(entries: ReadonlyArray<{ score: number; weight: number }>): number {
  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  return Math.max(
    0,
    Math.min(
      100,
      Math.round(
        entries.reduce((sum, entry) => sum + entry.score * entry.weight, 0) /
          Math.max(1, totalWeight),
      ),
    ),
  );
}

export function buildSelfImprovementEffectivenessDimension(params: {
  signals: readonly SelfImprovementSignal[];
  recommendations: readonly SelfImprovementRecommendation[];
  outbox: readonly SelfImprovementOutboxItem[];
  now: number;
}): SelfImprovementOperationalHealthDimension {
  const signalById = new Map(params.signals.map((signal) => [signal.id, signal]));
  const signalRecommendations = params.recommendations.flatMap((recommendation) => {
    const signalId = signalIdFromRecommendation(recommendation);
    return signalId && signalById.has(signalId) ? [{ signalId, recommendation }] : [];
  });
  const linkedSignalIds = new Set(signalRecommendations.map((entry) => entry.signalId));
  const completedSignalIds = new Set(
    params.outbox
      .filter((item) => item.kind === "signal_analysis" && item.status === "completed")
      .map((item) => item.entityId),
  );
  const analyzedSignalIds = new Set([...linkedSignalIds, ...completedSignalIds]);
  const signalCoverage = boundedPercent(analyzedSignalIds.size, params.signals.length);

  const recommendationCounts = new Map<string, number>();
  for (const entry of signalRecommendations) {
    recommendationCounts.set(entry.signalId, (recommendationCounts.get(entry.signalId) ?? 0) + 1);
  }
  const duplicateRecommendations = [...recommendationCounts.values()].reduce(
    (sum, count) => sum + Math.max(0, count - 1),
    0,
  );
  const duplicateRate = boundedPercent(
    duplicateRecommendations,
    Math.max(1, signalRecommendations.length),
    0,
  );
  const deduplicationScore = 100 - duplicateRate;

  const detectionP95Ms = percentile95(
    signalRecommendations.flatMap(({ signalId, recommendation }) => {
      const signal = signalById.get(signalId);
      return signal ? [Math.max(0, recommendation.createdAt - signal.firstSeenAt)] : [];
    }),
  );
  const detectionScore =
    detectionP95Ms <= DETECTION_P95_TARGET_MS ? 100 : detectionP95Ms <= 5 * 60_000 ? 70 : 20;

  const routingSignals = params.signals.filter((signal) => signal.capabilityRouting);
  const correctlyRouted = routingSignals.filter(
    (signal) =>
      (signal.capabilityRouting?.selected.length ?? 0) > 0 &&
      (signal.capabilityRouting?.missed.length ?? 0) === 0,
  ).length;
  const routingAccuracy = boundedPercent(correctlyRouted, routingSignals.length);

  const closedProofRequired = signalRecommendations.filter(
    ({ recommendation }) =>
      recommendation.status === "resolved" &&
      (recommendation.safety.requiresApproval || recommendation.safety.requiresTests),
  );
  const closedWithCurrentProof = closedProofRequired.filter(
    ({ recommendation }) =>
      Boolean(recommendation.resolutionProof?.trim()) &&
      recommendation.resolutionProofState !== "stale",
  ).length;
  const proofClosureRate = boundedPercent(closedWithCurrentProof, closedProofRequired.length);

  const recurrentWithProof = signalRecommendations.filter(
    ({ recommendation }) =>
      recommendation.recurrenceCount > 1 && Boolean(recommendation.resolutionProof?.trim()),
  );
  const safelyReopened = recurrentWithProof.filter(
    ({ recommendation }) =>
      recommendation.status === "reopened" && recommendation.resolutionProofState === "stale",
  ).length;
  const recurrenceSafety = boundedPercent(safelyReopened, recurrentWithProof.length);

  const lowConfidence = signalRecommendations.filter(
    ({ recommendation }) => recommendation.confidence < 0.75,
  );
  const lowConfidenceQuarantined = lowConfidence.filter(
    ({ recommendation }) => recommendation.status === "quarantined",
  ).length;
  const quarantineRate = boundedPercent(lowConfidenceQuarantined, lowConfidence.length);
  const escapedLowConfidence = lowConfidence.length - lowConfidenceQuarantined;

  const staleProcessing = params.outbox.filter(
    (item) => item.status === "processing" && (item.leaseExpiresAt ?? 0) <= params.now,
  ).length;
  const quarantinedOutbox = params.outbox.filter((item) => item.status === "quarantined").length;
  const outboxScore = Math.max(
    0,
    100 - staleProcessing * 25 - boundedPercent(quarantinedOutbox, params.outbox.length, 0),
  );

  const safetyViolations = signalRecommendations.filter(
    ({ recommendation }) =>
      recommendation.safety.mode !== "recommendation_only" || recommendation.safety.mutationAllowed,
  ).length;
  const safetyScore = safetyViolations === 0 ? 100 : 0;
  const coalescedNoiseSignals = params.signals.filter((signal) =>
    signal.idempotencyKey.startsWith("noise-budget:"),
  ).length;
  const score = weightedScore([
    { score: signalCoverage, weight: 20 },
    { score: deduplicationScore, weight: 15 },
    { score: detectionScore, weight: 10 },
    { score: routingAccuracy, weight: 15 },
    { score: proofClosureRate, weight: 15 },
    { score: recurrenceSafety, weight: 10 },
    { score: quarantineRate, weight: 5 },
    { score: outboxScore, weight: 5 },
    { score: safetyScore, weight: 5 },
  ]);
  const blockers = [
    safetyViolations > 0 ? `${safetyViolations} signal recommendation(s) violate safety mode.` : "",
    signalCoverage < SIGNAL_COVERAGE_TARGET
      ? `Signal analysis coverage is ${signalCoverage}%; target is ${SIGNAL_COVERAGE_TARGET}%.`
      : "",
    duplicateRate > DUPLICATE_RATE_MAX
      ? `Duplicate causal recommendation rate is ${duplicateRate}%; maximum is ${DUPLICATE_RATE_MAX}%.`
      : "",
    routingAccuracy < ROUTING_ACCURACY_TARGET
      ? `Capability routing accuracy is ${routingAccuracy}%; target is ${ROUTING_ACCURACY_TARGET}%.`
      : "",
    proofClosureRate < PROOF_CLOSURE_TARGET
      ? `Proof-backed closure rate is ${proofClosureRate}%; target is ${PROOF_CLOSURE_TARGET}%.`
      : "",
    detectionP95Ms > DETECTION_P95_TARGET_MS
      ? `Signal-to-recommendation p95 is ${detectionP95Ms}ms; target is ${DETECTION_P95_TARGET_MS}ms.`
      : "",
    escapedLowConfidence > 0
      ? `${escapedLowConfidence} low-confidence signal recommendation(s) escaped quarantine.`
      : "",
    staleProcessing > 0 ? `${staleProcessing} outbox lease(s) need replay recovery.` : "",
    quarantinedOutbox > 0 ? `${quarantinedOutbox} outbox item(s) exhausted retry budgets.` : "",
  ].filter(Boolean);
  const status = safetyViolations > 0 ? "blocked" : score >= TARGET_SCORE ? "ready" : "degraded";
  return {
    id: "effectiveness",
    label: "Outcome effectiveness",
    status,
    score,
    summary:
      status === "ready"
        ? "SIG meets the executable outcome-effectiveness and safety thresholds."
        : "SIG needs causal coverage, routing, proof, latency, or replay improvement.",
    metrics: [
      { key: "signals", label: "Signals", value: params.signals.length },
      { key: "signalCoverage", label: "Signal coverage %", value: signalCoverage },
      { key: "duplicateRate", label: "Duplicate rate %", value: duplicateRate },
      { key: "detectionP95Ms", label: "Detection p95 ms", value: detectionP95Ms },
      { key: "routingAccuracy", label: "Routing accuracy %", value: routingAccuracy },
      { key: "proofClosureRate", label: "Proof closure %", value: proofClosureRate },
      { key: "recurrenceSafety", label: "Recurrence safety %", value: recurrenceSafety },
      {
        key: "lowConfidenceQuarantine",
        label: "Low confidence quarantine %",
        value: quarantineRate,
      },
      { key: "outboxQuarantined", label: "Outbox quarantined", value: quarantinedOutbox },
      { key: "noiseBudgetBuckets", label: "Noise budget buckets", value: coalescedNoiseSignals },
      { key: "safetyViolations", label: "Safety violations", value: safetyViolations },
      { key: "qualityTarget", label: "Quality target", value: TARGET_SCORE },
    ],
    blockers,
    nextActions:
      status === "ready"
        ? ["Keep the effectiveness corpus and thresholds green during normal operation."]
        : ["Repair the failing effectiveness metric before expanding SIG autonomy."],
  };
}

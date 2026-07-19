// Executable Control Director user-experience and output-quality acceptance.
import {
  CONTROL_DIRECTOR_OUTPUT_QUALITY_MINIMUM,
  CONTROL_DIRECTOR_UX_SLOS,
} from "./control-director-slos.js";

export const CONTROL_DIRECTOR_QUALITY_RUBRIC_VERSION = 1 as const;
export { CONTROL_DIRECTOR_OUTPUT_QUALITY_MINIMUM } from "./control-director-slos.js";

export type ControlDirectorQualityMetric =
  | "ack_latency"
  | "first_activity_latency"
  | "activity_heartbeat_gap"
  | "cancel_ack_latency"
  | "substantive_response_latency"
  | "recent_recall_top3"
  | "instruction_coverage"
  | "layout_visibility"
  | "completion_proof"
  | "mission_continuity";

export type ControlDirectorQualityObservation = {
  metric: ControlDirectorQualityMetric;
  passed: boolean;
  score: number;
  critical: boolean;
  observed: string;
  evidenceRef: string;
};

export type ControlDirectorQualityAssessment = {
  schemaVersion: typeof CONTROL_DIRECTOR_QUALITY_RUBRIC_VERSION;
  score: number;
  passed: boolean;
  criticalOmissions: ControlDirectorQualityObservation[];
  failed: ControlDirectorQualityObservation[];
  observations: ControlDirectorQualityObservation[];
};

function boundedScore(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

export function latencyQualityObservation(params: {
  metric: Extract<
    ControlDirectorQualityMetric,
    | "ack_latency"
    | "first_activity_latency"
    | "activity_heartbeat_gap"
    | "cancel_ack_latency"
    | "substantive_response_latency"
  >;
  observedMs: number;
  limitMs: number;
  evidenceRef: string;
  critical?: boolean;
}): ControlDirectorQualityObservation {
  const observedMs = Math.max(0, params.observedMs);
  const limitMs = Math.max(1, params.limitMs);
  const passed = observedMs <= limitMs;
  const score = passed ? 100 : boundedScore(100 - ((observedMs - limitMs) / limitMs) * 100);
  return {
    metric: params.metric,
    passed,
    score,
    critical: params.critical ?? true,
    observed: `${Math.round(observedMs)}ms <= ${Math.round(limitMs)}ms`,
    evidenceRef: params.evidenceRef,
  };
}

export function booleanQualityObservation(params: {
  metric: Exclude<
    ControlDirectorQualityMetric,
    | "ack_latency"
    | "first_activity_latency"
    | "activity_heartbeat_gap"
    | "cancel_ack_latency"
    | "substantive_response_latency"
  >;
  passed: boolean;
  evidenceRef: string;
  observed: string;
  critical?: boolean;
  score?: number;
}): ControlDirectorQualityObservation {
  return {
    metric: params.metric,
    passed: params.passed,
    score: boundedScore(params.score ?? (params.passed ? 100 : 0)),
    critical: params.critical ?? true,
    observed: params.observed,
    evidenceRef: params.evidenceRef,
  };
}

/**
 * Quality never passes by averaging away a critical omission. Every observation
 * also needs a concrete evidence reference so an unproved score cannot pass.
 */
export function assessControlDirectorQuality(
  observations: readonly ControlDirectorQualityObservation[],
  minimumScore = CONTROL_DIRECTOR_OUTPUT_QUALITY_MINIMUM,
): ControlDirectorQualityAssessment {
  const normalized = observations.map((observation) => ({
    ...observation,
    score: boundedScore(observation.score),
    evidenceRef: observation.evidenceRef.trim(),
  }));
  const missingEvidence = normalized.filter((observation) => !observation.evidenceRef);
  const failed = normalized.filter(
    (observation) => !observation.passed || !observation.evidenceRef,
  );
  const criticalOmissions = failed.filter((observation) => observation.critical);
  const score =
    normalized.length === 0
      ? 0
      : Math.round(
          (normalized.reduce((sum, observation) => sum + observation.score, 0) /
            normalized.length) *
            10,
        ) / 10;
  return {
    schemaVersion: CONTROL_DIRECTOR_QUALITY_RUBRIC_VERSION,
    score,
    passed:
      normalized.length > 0 &&
      missingEvidence.length === 0 &&
      criticalOmissions.length === 0 &&
      score >= minimumScore,
    criticalOmissions,
    failed,
    observations: normalized,
  };
}

export function buildControlDirectorLatencyObservations(params: {
  ackMs: number;
  firstActivityMs: number;
  maximumActivityGapMs: number;
  cancelAckMs: number;
  substantiveResponseMs: number;
  cold: boolean;
  evidencePrefix: string;
}): ControlDirectorQualityObservation[] {
  const ref = (metric: string) =>
    params.evidencePrefix.trim() ? `${params.evidencePrefix.trim()}:${metric}` : "";
  return [
    latencyQualityObservation({
      metric: "ack_latency",
      observedMs: params.ackMs,
      limitMs: CONTROL_DIRECTOR_UX_SLOS.ackMs,
      evidenceRef: ref("ack"),
    }),
    latencyQualityObservation({
      metric: "first_activity_latency",
      observedMs: params.firstActivityMs,
      limitMs: CONTROL_DIRECTOR_UX_SLOS.firstActivityMs,
      evidenceRef: ref("activity"),
    }),
    latencyQualityObservation({
      metric: "activity_heartbeat_gap",
      observedMs: params.maximumActivityGapMs,
      limitMs: CONTROL_DIRECTOR_UX_SLOS.activityHeartbeatMs,
      evidenceRef: ref("heartbeat"),
    }),
    latencyQualityObservation({
      metric: "cancel_ack_latency",
      observedMs: params.cancelAckMs,
      limitMs: CONTROL_DIRECTOR_UX_SLOS.cancelAckMs,
      evidenceRef: ref("cancel"),
    }),
    latencyQualityObservation({
      metric: "substantive_response_latency",
      observedMs: params.substantiveResponseMs,
      limitMs: params.cold
        ? CONTROL_DIRECTOR_UX_SLOS.coldSubstantiveResponseMs
        : CONTROL_DIRECTOR_UX_SLOS.warmSubstantiveResponseMs,
      evidenceRef: ref(params.cold ? "cold-response" : "warm-response"),
      critical: false,
    }),
  ];
}

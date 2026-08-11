// PCC learning-store helpers persist recommendation records without creating an execution path.
import {
  PCC_LEARNING_CANDIDATE_VERSION,
  PCC_LEARNING_METRIC_NAMES,
  type PccLearningCandidateStatus,
  type PccLearningCandidateV1,
  type PccLearningMetrics,
} from "./learning-candidates.js";

export const PCC_LEARNING_CANDIDATES_METADATA_KEY = "pccLearningCandidates" as const;
export const PCC_LEARNING_CANDIDATE_LIMIT = 100;

const STATUSES = new Set<PccLearningCandidateStatus>([
  "proposed",
  "approved",
  "trial",
  "promoted",
  "rejected",
  "superseded",
  "expired",
]);

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isoTimestamp(value: unknown): value is string {
  return nonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function metrics(value: unknown): PccLearningMetrics | undefined {
  const source = record(value);
  const entries = PCC_LEARNING_METRIC_NAMES.map((name) => [name, source[name]] as const);
  if (
    !entries.every(
      ([, score]) =>
        typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 100,
    )
  ) {
    return undefined;
  }
  return Object.fromEntries(entries) as unknown as PccLearningMetrics;
}

function candidate(value: unknown): PccLearningCandidateV1 | null {
  const source = record(value);
  if (
    source.version !== PCC_LEARNING_CANDIDATE_VERSION ||
    !nonEmptyString(source.id) ||
    !nonEmptyString(source.fingerprint) ||
    !nonEmptyString(source.status) ||
    !STATUSES.has(source.status as PccLearningCandidateStatus) ||
    !nonEmptyString(source.projectId) ||
    !nonEmptyString(source.revision) ||
    !nonEmptyString(source.receiptId) ||
    !nonEmptyString(source.decisionId) ||
    !Array.isArray(source.evidenceIds) ||
    !source.evidenceIds.every(nonEmptyString) ||
    !nonEmptyString(source.contentSummary) ||
    !isoTimestamp(source.createdAt) ||
    !isoTimestamp(source.updatedAt) ||
    !isoTimestamp(source.expiresAt)
  ) {
    return null;
  }
  const baselineMetrics =
    source.baselineMetrics === undefined ? undefined : metrics(source.baselineMetrics);
  const afterMetrics = source.afterMetrics === undefined ? undefined : metrics(source.afterMetrics);
  if (
    (source.baselineMetrics !== undefined && !baselineMetrics) ||
    (source.afterMetrics !== undefined && !afterMetrics)
  ) {
    return null;
  }
  return {
    version: PCC_LEARNING_CANDIDATE_VERSION,
    id: source.id,
    fingerprint: source.fingerprint,
    status: source.status as PccLearningCandidateStatus,
    projectId: source.projectId,
    revision: source.revision,
    receiptId: source.receiptId,
    decisionId: source.decisionId,
    evidenceIds: [...new Set(source.evidenceIds)].toSorted(),
    contentSummary: source.contentSummary,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    expiresAt: source.expiresAt,
    ...(baselineMetrics ? { baselineMetrics: { ...baselineMetrics } } : {}),
    ...(afterMetrics ? { afterMetrics: { ...afterMetrics } } : {}),
    ...(nonEmptyString(source.statusReason) ? { statusReason: source.statusReason } : {}),
  };
}

function cloneCandidate(value: PccLearningCandidateV1): PccLearningCandidateV1 {
  return {
    ...value,
    evidenceIds: [...value.evidenceIds],
    ...(value.baselineMetrics ? { baselineMetrics: { ...value.baselineMetrics } } : {}),
    ...(value.afterMetrics ? { afterMetrics: { ...value.afterMetrics } } : {}),
  };
}

/** Reads only canonical records. Unknown or malformed legacy metadata is ignored safely. */
export function readPccLearningCandidates(metadata: unknown): PccLearningCandidateV1[] {
  const raw = record(metadata)[PCC_LEARNING_CANDIDATES_METADATA_KEY];
  if (!Array.isArray(raw)) {
    return [];
  }
  const byFingerprint = new Map<string, PccLearningCandidateV1>();
  for (const item of raw) {
    const parsed = candidate(item);
    if (!parsed) {
      continue;
    }
    const previous = byFingerprint.get(parsed.fingerprint);
    if (!previous || Date.parse(parsed.updatedAt) > Date.parse(previous.updatedAt)) {
      byFingerprint.set(parsed.fingerprint, parsed);
    }
  }
  return [...byFingerprint.values()]
    .toSorted(
      (left, right) =>
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || left.id.localeCompare(right.id),
    )
    .slice(0, PCC_LEARNING_CANDIDATE_LIMIT)
    .map(cloneCandidate);
}

/**
 * Returns new metadata with a bounded, deduplicated candidate list. This helper never executes,
 * approves, promotes, or applies a recommendation.
 */
export function storePccLearningCandidate(
  metadata: unknown,
  value: PccLearningCandidateV1,
  maxCandidates = PCC_LEARNING_CANDIDATE_LIMIT,
): Record<string, unknown> {
  const parsed = candidate(value);
  if (!parsed) {
    throw new Error("Invalid PCC learning candidate: cannot persist malformed record");
  }
  const limit = Number.isFinite(maxCandidates)
    ? Math.max(1, Math.min(PCC_LEARNING_CANDIDATE_LIMIT, Math.floor(maxCandidates)))
    : PCC_LEARNING_CANDIDATE_LIMIT;
  const existing = readPccLearningCandidates(metadata).filter(
    (item) => item.id !== parsed.id && item.fingerprint !== parsed.fingerprint,
  );
  const candidates = [parsed, ...existing]
    .toSorted(
      (left, right) =>
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || left.id.localeCompare(right.id),
    )
    .slice(0, limit)
    .map(cloneCandidate);
  return {
    ...record(metadata),
    [PCC_LEARNING_CANDIDATES_METADATA_KEY]: candidates,
  };
}

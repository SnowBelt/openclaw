// PCC learning candidates are evidence-bound recommendations, never an action path.
import { createHash } from "node:crypto";

export const PCC_LEARNING_CANDIDATE_VERSION = 1 as const;
export const PCC_LEARNING_METRIC_NAMES = [
  "speed",
  "accuracy",
  "efficiency",
  "first_pass_quality",
  "qa",
  "overall_quality",
] as const;

export type PccLearningMetricName = (typeof PCC_LEARNING_METRIC_NAMES)[number];
export type PccLearningMetrics = Readonly<Record<PccLearningMetricName, number>>;
export type PccLearningCandidateStatus =
  | "proposed"
  | "approved"
  | "trial"
  | "promoted"
  | "rejected"
  | "superseded"
  | "expired";

type PccSanitizedFinalizedSource = {
  id: string;
  projectId: string;
  revision: string;
  finalized: true;
  sanitized: true;
};

export type PccLearningCandidateReceiptInput = PccSanitizedFinalizedSource & {
  evidenceIds: readonly string[];
};

export type PccLearningCandidateEvidenceInput = PccSanitizedFinalizedSource & {
  status: "passed";
};

export type PccLearningCandidateDecisionInput = PccSanitizedFinalizedSource & {
  evidenceIds: readonly string[];
};

/** The bridge deliberately accepts summaries and identifiers, never raw PCC output. */
export type PccLearningCandidateInput = {
  projectId: string;
  revision: string;
  currentRevision: string;
  receipt: PccLearningCandidateReceiptInput;
  evidence: readonly PccLearningCandidateEvidenceInput[];
  decision: PccLearningCandidateDecisionInput;
  contentSummary: string;
  createdAt: string;
  expiresAt: string;
};

export type PccLearningCandidateV1 = {
  version: typeof PCC_LEARNING_CANDIDATE_VERSION;
  id: string;
  fingerprint: string;
  status: PccLearningCandidateStatus;
  projectId: string;
  revision: string;
  receiptId: string;
  decisionId: string;
  evidenceIds: readonly string[];
  contentSummary: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  baselineMetrics?: PccLearningMetrics;
  afterMetrics?: PccLearningMetrics;
  statusReason?: string;
};

export type PccLearningCandidateCreateResult = {
  candidate: PccLearningCandidateV1;
  deduplicated: boolean;
};

export type PccLearningCandidateTransition = {
  status: PccLearningCandidateStatus;
  updatedAt: string;
  reason?: string;
  baselineMetrics?: PccLearningMetrics;
  afterMetrics?: PccLearningMetrics;
};

const MAX_SUMMARY_LENGTH = 4_000;
const SECRET_LIKE_CONTENT = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/iu,
  /\b(?:api[_-]?key|password|secret|token|authorization)\s*[:=]/iu,
  /\b(?:sk|rk|pk)_[A-Za-z0-9_-]{16,}/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/u,
];
const RAW_OUTPUT_KEYS = new Set(["rawoutput", "raw_output", "modeloutput", "transcript"]);
const TERMINAL_STATUSES = new Set<PccLearningCandidateStatus>([
  "promoted",
  "rejected",
  "superseded",
  "expired",
]);
const ALLOWED_TRANSITIONS: Readonly<
  Record<PccLearningCandidateStatus, readonly PccLearningCandidateStatus[]>
> = {
  proposed: ["approved", "rejected", "superseded", "expired"],
  approved: ["trial", "rejected", "superseded", "expired"],
  trial: ["promoted", "rejected", "superseded", "expired"],
  promoted: [],
  rejected: [],
  superseded: [],
  expired: [],
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Invalid PCC learning candidate: ${message}`);
  }
}

function assertTimestamp(value: string, name: string): void {
  assert(Number.isFinite(Date.parse(value)), `${name} must be an ISO timestamp`);
}

function assertId(value: string, name: string): void {
  assert(value.trim().length > 0 && value.length <= 512, `${name} must be a bounded identifier`);
}

function hasRawOutput(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some(hasRawOutput);
  }
  return Object.entries(value as Record<string, unknown>).some(
    ([key, nested]) => RAW_OUTPUT_KEYS.has(key.toLowerCase()) || hasRawOutput(nested),
  );
}

function assertSanitizedSummary(value: string): void {
  assert(value.trim().length > 0, "contentSummary is required");
  assert(
    value.length <= MAX_SUMMARY_LENGTH,
    `contentSummary exceeds ${MAX_SUMMARY_LENGTH} characters`,
  );
  assert(
    !SECRET_LIKE_CONTENT.some((pattern) => pattern.test(value)),
    "contentSummary is secret-like",
  );
}

function sortedUniqueIds(ids: readonly string[], name: string): string[] {
  assert(ids.length > 0, `${name} is required`);
  const result = [...new Set(ids.map((id) => id.trim()))].toSorted();
  result.forEach((id) => assertId(id, name));
  return result;
}

function assertSource(
  source: PccSanitizedFinalizedSource,
  kind: string,
  projectId: string,
  revision: string,
): void {
  assertId(source.id, `${kind}.id`);
  assert(source.finalized, `${kind} must be finalized`);
  assert(source.sanitized, `${kind} must be sanitized`);
  assert(source.projectId === projectId, `${kind} projectId does not match`);
  assert(source.revision === revision, `${kind} revision does not match`);
}

function fingerprintPayload(input: PccLearningCandidateInput, evidenceIds: readonly string[]) {
  return JSON.stringify({
    version: PCC_LEARNING_CANDIDATE_VERSION,
    projectId: input.projectId,
    revision: input.revision,
    receiptId: input.receipt.id,
    decisionId: input.decision.id,
    evidenceIds,
    contentSummary: input.contentSummary.trim(),
  });
}

export function fingerprintPccLearningCandidate(input: PccLearningCandidateInput): string {
  const evidenceIds = sortedUniqueIds(
    input.evidence.map((item) => item.id),
    "evidence id",
  );
  return createHash("sha256").update(fingerprintPayload(input, evidenceIds)).digest("hex");
}

export function createPccLearningCandidate(
  input: PccLearningCandidateInput,
  existing: readonly PccLearningCandidateV1[] = [],
): PccLearningCandidateCreateResult {
  assert(!hasRawOutput(input), "raw output is not accepted");
  assertId(input.projectId, "projectId");
  assertId(input.revision, "revision");
  assert(input.revision === input.currentRevision, "revision is stale");
  assertTimestamp(input.createdAt, "createdAt");
  assertTimestamp(input.expiresAt, "expiresAt");
  assert(
    Date.parse(input.expiresAt) > Date.parse(input.createdAt),
    "expiresAt must be after createdAt",
  );
  assertSanitizedSummary(input.contentSummary);
  assertSource(input.receipt, "receipt", input.projectId, input.revision);
  assertSource(input.decision, "decision", input.projectId, input.revision);
  const receiptEvidenceIds = sortedUniqueIds(input.receipt.evidenceIds, "receipt evidence id");
  const decisionEvidenceIds = sortedUniqueIds(input.decision.evidenceIds, "decision evidence id");
  const evidenceIds = sortedUniqueIds(
    input.evidence.map((item) => item.id),
    "evidence id",
  );
  input.evidence.forEach((item) => {
    assertSource(item, "evidence", input.projectId, input.revision);
    assert(item.status === "passed", "evidence must have passed");
  });
  assert(
    receiptEvidenceIds.every((id) => evidenceIds.includes(id)),
    "receipt evidence is missing from finalized proof",
  );
  assert(
    decisionEvidenceIds.every((id) => evidenceIds.includes(id)),
    "decision evidence is missing from finalized proof",
  );

  const fingerprint = createHash("sha256")
    .update(fingerprintPayload(input, evidenceIds))
    .digest("hex");
  const duplicate = existing.find((candidate) => candidate.fingerprint === fingerprint);
  if (duplicate) {
    return { candidate: duplicate, deduplicated: true };
  }
  return {
    deduplicated: false,
    candidate: {
      version: PCC_LEARNING_CANDIDATE_VERSION,
      id: `pcc-learning-${fingerprint}`,
      fingerprint,
      status: "proposed",
      projectId: input.projectId,
      revision: input.revision,
      receiptId: input.receipt.id,
      decisionId: input.decision.id,
      evidenceIds,
      contentSummary: input.contentSummary.trim(),
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      expiresAt: input.expiresAt,
    },
  };
}

export function pccLearningCandidateIsExpired(
  candidate: PccLearningCandidateV1,
  now: string,
): boolean {
  assertTimestamp(now, "now");
  return Date.parse(now) >= Date.parse(candidate.expiresAt);
}

function assertMetrics(metrics: PccLearningMetrics, label: string): void {
  for (const name of PCC_LEARNING_METRIC_NAMES) {
    const value = metrics[name];
    assert(
      typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100,
      `${label}.${name} must be between 0 and 100`,
    );
  }
}

export function pccLearningPromotionMetricsPass(
  baseline: PccLearningMetrics | undefined,
  after: PccLearningMetrics | undefined,
): boolean {
  if (!baseline || !after) {
    return false;
  }
  try {
    assertMetrics(baseline, "baselineMetrics");
    assertMetrics(after, "afterMetrics");
  } catch {
    return false;
  }
  return PCC_LEARNING_METRIC_NAMES.every(
    (name) => after[name] >= 93 && after[name] >= baseline[name],
  );
}

/** Returns a new record only; callers persist it through their approved owner path. */
export function transitionPccLearningCandidate(
  candidate: PccLearningCandidateV1,
  transition: PccLearningCandidateTransition,
): PccLearningCandidateV1 {
  assertTimestamp(transition.updatedAt, "updatedAt");
  assert(
    Date.parse(transition.updatedAt) >= Date.parse(candidate.updatedAt),
    "updatedAt cannot move backward",
  );
  if (pccLearningCandidateIsExpired(candidate, transition.updatedAt)) {
    assert(transition.status === "expired", "candidate is expired");
  }
  assert(
    !TERMINAL_STATUSES.has(candidate.status),
    `cannot transition terminal status ${candidate.status}`,
  );
  assert(
    ALLOWED_TRANSITIONS[candidate.status].includes(transition.status),
    `cannot transition ${candidate.status} to ${transition.status}`,
  );
  const baselineMetrics = transition.baselineMetrics ?? candidate.baselineMetrics;
  const afterMetrics = transition.afterMetrics ?? candidate.afterMetrics;
  if (baselineMetrics) {
    assertMetrics(baselineMetrics, "baselineMetrics");
  }
  if (afterMetrics) {
    assertMetrics(afterMetrics, "afterMetrics");
  }
  if (transition.status === "promoted") {
    assert(
      pccLearningPromotionMetricsPass(baselineMetrics, afterMetrics),
      "promotion requires all after metrics at least 93 with no regression from baseline",
    );
  }
  return {
    ...candidate,
    status: transition.status,
    updatedAt: transition.updatedAt,
    ...(transition.reason ? { statusReason: transition.reason.trim() } : {}),
    ...(baselineMetrics ? { baselineMetrics: { ...baselineMetrics } } : {}),
    ...(afterMetrics ? { afterMetrics: { ...afterMetrics } } : {}),
  };
}

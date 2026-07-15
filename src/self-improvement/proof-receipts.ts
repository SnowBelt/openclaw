import crypto from "node:crypto";
import { appendSelfImprovementAuditEvent } from "./audit-events.js";
import { listSelfImprovementLedgerRows, upsertSelfImprovementLedgerRows } from "./ledger.js";
import { attachSelfImprovementOutcomeProof, getSelfImprovementRecommendation } from "./store.js";
import { sanitizeRecommendationText, sanitizeRecommendationTexts } from "./text.js";

export type SelfImprovementProofReceiptStatus = "passed" | "failed" | "stale";

export type SelfImprovementProofReceipt = {
  id: string;
  version: 1;
  recommendationId: string;
  signalId?: string;
  diagnosis: string;
  action: string;
  metric: {
    name: string;
    baseline?: string;
    target: string;
    observed: string;
    unit?: string;
    passed: boolean;
  };
  observation: {
    startedAt: number;
    endedAt: number;
    minimumDurationMs: number;
  };
  holdout: {
    required: boolean;
    passed?: boolean;
  };
  evidenceRefs: string[];
  status: SelfImprovementProofReceiptStatus;
  outcomeConfirmed: boolean;
  createdAt: number;
  verifiedAt: number;
};

export type SelfImprovementProofReceiptInput = {
  recommendationId: string;
  signalId?: string;
  diagnosis: string;
  action: string;
  metric: {
    name: string;
    baseline?: string;
    target: string;
    observed: string;
    unit?: string;
    passed: boolean;
  };
  observation: {
    startedAt: number;
    endedAt: number;
    minimumDurationMs?: number;
  };
  holdout?: {
    required?: boolean;
    passed?: boolean;
  };
  evidenceRefs: readonly string[];
};

function timestamp(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Outcome proof ${label} must be a non-negative finite timestamp.`);
  }
  return Math.floor(value);
}

function receiptId(params: {
  recommendationId: string;
  signalId?: string;
  action: string;
  metricObserved: string;
  metricPassed: boolean;
  holdoutPassed: boolean;
  endedAt: number;
}): string {
  const fingerprint = crypto
    .createHash("sha256")
    .update(
      [
        params.recommendationId,
        params.signalId ?? "",
        params.action,
        params.metricObserved,
        String(params.metricPassed),
        String(params.holdoutPassed),
        String(params.endedAt),
      ].join("\n"),
    )
    .digest("hex");
  return `sipr_${fingerprint.slice(0, 20)}`;
}

function normalizeProofReceipt(
  input: SelfImprovementProofReceiptInput,
  now: number,
): SelfImprovementProofReceipt {
  const recommendationId = sanitizeRecommendationText(input.recommendationId, 120);
  const signalId = sanitizeRecommendationText(input.signalId, 120);
  const diagnosis = sanitizeRecommendationText(input.diagnosis, 640);
  const action = sanitizeRecommendationText(input.action, 640);
  const name = sanitizeRecommendationText(input.metric.name, 120);
  const baseline = sanitizeRecommendationText(input.metric.baseline, 180);
  const target = sanitizeRecommendationText(input.metric.target, 180);
  const observed = sanitizeRecommendationText(input.metric.observed, 180);
  const unit = sanitizeRecommendationText(input.metric.unit, 80);
  const evidenceRefs = sanitizeRecommendationTexts(input.evidenceRefs.slice(0, 24), 240);
  if (!recommendationId || !diagnosis || !action || !name || !target || !observed) {
    throw new Error(
      "Outcome proof requires recommendation, diagnosis, action, metric name, target, and observation.",
    );
  }
  const startedAt = timestamp(input.observation.startedAt, "startedAt");
  const endedAt = timestamp(input.observation.endedAt, "endedAt");
  const minimumDurationMs = Math.max(0, Math.floor(input.observation.minimumDurationMs ?? 0));
  const observationPassed = endedAt >= startedAt && endedAt - startedAt >= minimumDurationMs;
  const holdoutRequired = input.holdout?.required ?? false;
  const holdoutPassed = input.holdout?.passed ?? false;
  const outcomeConfirmed =
    input.metric.passed &&
    observationPassed &&
    evidenceRefs.length > 0 &&
    (!holdoutRequired || holdoutPassed);
  return {
    id: receiptId({
      recommendationId,
      ...(signalId ? { signalId } : {}),
      action,
      metricObserved: observed,
      metricPassed: input.metric.passed,
      holdoutPassed,
      endedAt,
    }),
    version: 1,
    recommendationId,
    ...(signalId ? { signalId } : {}),
    diagnosis,
    action,
    metric: {
      name,
      ...(baseline ? { baseline } : {}),
      target,
      observed,
      ...(unit ? { unit } : {}),
      passed: input.metric.passed,
    },
    observation: { startedAt, endedAt, minimumDurationMs },
    holdout: {
      required: holdoutRequired,
      ...(holdoutRequired || input.holdout?.passed !== undefined ? { passed: holdoutPassed } : {}),
    },
    evidenceRefs,
    status: outcomeConfirmed ? "passed" : "failed",
    outcomeConfirmed,
    createdAt: now,
    verifiedAt: now,
  };
}

export function isSelfImprovementProofReceiptClosureReady(
  receipt: SelfImprovementProofReceipt,
): boolean {
  return receipt.status === "passed" && receipt.outcomeConfirmed;
}

export async function listSelfImprovementProofReceipts(params?: {
  stateDir?: string;
  recommendationId?: string;
  limit?: number;
}): Promise<SelfImprovementProofReceipt[]> {
  const rows = await listSelfImprovementLedgerRows<SelfImprovementProofReceipt>({
    stateDir: params?.stateDir,
    collection: "proof_receipts",
  });
  const limit = params?.limit && params.limit > 0 ? Math.floor(params.limit) : 2_000;
  return rows
    .map((row) => row.value)
    .filter(
      (receipt) =>
        !params?.recommendationId || receipt.recommendationId === params.recommendationId,
    )
    .toSorted(
      (left, right) => right.verifiedAt - left.verifiedAt || left.id.localeCompare(right.id),
    )
    .slice(0, limit);
}

export async function recordSelfImprovementProofReceipt(params: {
  input: SelfImprovementProofReceiptInput;
  stateDir?: string;
  now?: number;
}): Promise<SelfImprovementProofReceipt> {
  const recommendation = await getSelfImprovementRecommendation({
    id: params.input.recommendationId,
    stateDir: params.stateDir,
  });
  if (!recommendation) {
    throw new Error(`Unknown Self-Improvement recommendation ${params.input.recommendationId}.`);
  }
  const expectedSignalId = recommendation.source.runId?.startsWith("signal:")
    ? recommendation.source.runId.slice("signal:".length)
    : undefined;
  if (expectedSignalId && params.input.signalId !== expectedSignalId) {
    throw new Error(
      `Outcome proof signal ${params.input.signalId ?? "missing"} does not match ${expectedSignalId}.`,
    );
  }
  const receipt = normalizeProofReceipt(params.input, params.now ?? Date.now());
  await upsertSelfImprovementLedgerRows({
    stateDir: params.stateDir,
    collection: "proof_receipts",
    rows: [receipt],
    id: (entry) => entry.id,
    createdAt: (entry) => entry.createdAt,
    updatedAt: (entry) => entry.verifiedAt,
  });
  await attachSelfImprovementOutcomeProof({
    stateDir: params.stateDir,
    id: recommendation.id,
    proofReceiptId: receipt.id,
    outcomeState: receipt.outcomeConfirmed ? "confirmed" : "failed",
    ...(receipt.outcomeConfirmed
      ? {
          proofSummary: `Outcome proof ${receipt.id}: ${receipt.metric.name} observed ${receipt.metric.observed} against target ${receipt.metric.target}.`,
        }
      : {}),
    now: receipt.verifiedAt,
  });
  await appendSelfImprovementAuditEvent({
    stateDir: params.stateDir,
    event: {
      createdAt: receipt.verifiedAt,
      actor: "operator",
      kind: "outcome_proof_recorded",
      targetId: recommendation.id,
      summary: "Recorded a bounded Self-Improvement outcome proof receipt.",
      metadata: {
        receiptId: receipt.id,
        status: receipt.status,
        outcomeConfirmed: receipt.outcomeConfirmed,
        metricPassed: receipt.metric.passed,
        holdoutRequired: receipt.holdout.required,
        holdoutPassed: receipt.holdout.passed === true,
        observationMs: Math.max(0, receipt.observation.endedAt - receipt.observation.startedAt),
        evidenceCount: receipt.evidenceRefs.length,
      },
    },
  });
  return structuredClone(receipt);
}

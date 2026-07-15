import { z } from "zod";
import {
  evaluateSelfImprovementProductionSoak,
  type SelfImprovementSoakEvaluation,
  type SelfImprovementSoakInput,
  type SelfImprovementSoakSample,
} from "./acceptance.js";

export const SELF_IMPROVEMENT_SOAK_RECEIPT_VERSION = 1;
export const SELF_IMPROVEMENT_SOAK_MAX_SAMPLES = 64;

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const nonEmptyStringSchema = z.string().trim().min(1);
const timestampSchema = z.number().int().nonnegative().safe();

const soakSampleSchema = z.object({
  observedAt: timestampSchema,
  runtimeReleaseId: nonEmptyStringSchema,
  productionReady: z.boolean(),
  productionScore: z.number().finite(),
  blockers: z.array(z.string()),
  rpcReady: z.boolean(),
  dashboardReady: z.boolean(),
  safetyViolations: z.number().int().nonnegative(),
});

const rollbackEvidenceSchema = z.object({
  path: nonEmptyStringSchema,
  sha256: sha256Schema,
});

const rollbackResultSchema = z.object({
  performedAt: timestampSchema,
  fromReleaseId: nonEmptyStringSchema,
  toReleaseId: nonEmptyStringSchema,
  verifiedAt: timestampSchema,
});

export const selfImprovementSoakReceiptSchema = z.object({
  version: z.literal(SELF_IMPROVEMENT_SOAK_RECEIPT_VERSION),
  candidateReleaseId: nonEmptyStringSchema,
  rollbackReleaseId: nonEmptyStringSchema.optional(),
  automaticRollbackEnabled: z.boolean(),
  startedAt: timestampSchema,
  updatedAt: timestampSchema,
  samples: z.array(soakSampleSchema).max(SELF_IMPROVEMENT_SOAK_MAX_SAMPLES),
  managedRestartReleaseIds: z.array(nonEmptyStringSchema).max(8),
  rollbackEvidence: rollbackEvidenceSchema,
  rollbackResult: rollbackResultSchema.optional(),
  lastError: z.string().trim().min(1).optional(),
});

export type SelfImprovementSoakRollbackEvidence = z.infer<typeof rollbackEvidenceSchema>;
export type SelfImprovementSoakReceipt = z.infer<typeof selfImprovementSoakReceiptSchema>;

export function createSelfImprovementSoakReceipt(params: {
  candidateReleaseId: string;
  rollbackReleaseId?: string;
  automaticRollbackEnabled: boolean;
  startedAt: number;
  rollbackEvidence: SelfImprovementSoakRollbackEvidence;
}): SelfImprovementSoakReceipt {
  const candidateReleaseId = params.candidateReleaseId.trim();
  const rollbackReleaseId = params.rollbackReleaseId?.trim() || undefined;
  if (params.automaticRollbackEnabled && !rollbackReleaseId) {
    throw new Error("Automatic rollback requires a rollback release id.");
  }
  if (rollbackReleaseId === candidateReleaseId) {
    throw new Error("Rollback release must differ from the candidate release.");
  }
  return selfImprovementSoakReceiptSchema.parse({
    version: SELF_IMPROVEMENT_SOAK_RECEIPT_VERSION,
    candidateReleaseId,
    ...(rollbackReleaseId ? { rollbackReleaseId } : {}),
    automaticRollbackEnabled: params.automaticRollbackEnabled,
    startedAt: params.startedAt,
    updatedAt: params.startedAt,
    samples: [],
    managedRestartReleaseIds: [],
    rollbackEvidence: params.rollbackEvidence,
  });
}

export function parseSelfImprovementSoakReceipt(value: unknown): SelfImprovementSoakReceipt {
  return selfImprovementSoakReceiptSchema.parse(value);
}

export function appendSelfImprovementSoakSample(params: {
  receipt: SelfImprovementSoakReceipt;
  sample: SelfImprovementSoakSample;
}): SelfImprovementSoakReceipt {
  const receipt = parseSelfImprovementSoakReceipt(params.receipt);
  const sample = soakSampleSchema.parse(params.sample);
  if (sample.observedAt < receipt.startedAt) {
    throw new Error("Soak sample precedes the receipt start time.");
  }
  const samples = [
    ...receipt.samples.filter((entry) => entry.observedAt !== sample.observedAt),
    sample,
  ]
    .toSorted((left, right) => left.observedAt - right.observedAt)
    .slice(-SELF_IMPROVEMENT_SOAK_MAX_SAMPLES);
  return parseSelfImprovementSoakReceipt({
    ...receipt,
    updatedAt: Math.max(receipt.updatedAt, sample.observedAt),
    samples,
    lastError: undefined,
  });
}

export function recordSelfImprovementSoakRestart(params: {
  receipt: SelfImprovementSoakReceipt;
  releaseId: string;
  observedAt: number;
}): SelfImprovementSoakReceipt {
  const receipt = parseSelfImprovementSoakReceipt(params.receipt);
  const releaseId = params.releaseId.trim();
  if (releaseId !== receipt.candidateReleaseId) {
    throw new Error("Managed restart did not return to the candidate release.");
  }
  return parseSelfImprovementSoakReceipt({
    ...receipt,
    updatedAt: Math.max(receipt.updatedAt, params.observedAt),
    managedRestartReleaseIds: [...receipt.managedRestartReleaseIds, releaseId].slice(-8),
    lastError: undefined,
  });
}

export function recordSelfImprovementSoakError(params: {
  receipt: SelfImprovementSoakReceipt;
  error: string;
  observedAt: number;
}): SelfImprovementSoakReceipt {
  return parseSelfImprovementSoakReceipt({
    ...params.receipt,
    updatedAt: Math.max(params.receipt.updatedAt, params.observedAt),
    lastError: params.error.trim() || "Unknown soak error.",
  });
}

export function recordSelfImprovementSoakRollback(params: {
  receipt: SelfImprovementSoakReceipt;
  performedAt: number;
  verifiedAt: number;
  toReleaseId: string;
}): SelfImprovementSoakReceipt {
  const receipt = parseSelfImprovementSoakReceipt(params.receipt);
  if (!receipt.rollbackReleaseId || params.toReleaseId !== receipt.rollbackReleaseId) {
    throw new Error("Rollback verification did not match the preregistered rollback release.");
  }
  return parseSelfImprovementSoakReceipt({
    ...receipt,
    updatedAt: Math.max(receipt.updatedAt, params.verifiedAt),
    rollbackResult: {
      performedAt: params.performedAt,
      fromReleaseId: receipt.candidateReleaseId,
      toReleaseId: params.toReleaseId,
      verifiedAt: params.verifiedAt,
    },
    lastError: undefined,
  });
}

export function shouldAutomaticallyRollbackSelfImprovementSoak(params: {
  receipt: SelfImprovementSoakReceipt;
  sample: SelfImprovementSoakSample;
  qualityTarget?: number;
}): boolean {
  const receipt = parseSelfImprovementSoakReceipt(params.receipt);
  const sample = soakSampleSchema.parse(params.sample);
  if (
    !receipt.automaticRollbackEnabled ||
    receipt.rollbackResult ||
    !receipt.rollbackReleaseId ||
    sample.runtimeReleaseId !== receipt.candidateReleaseId
  ) {
    return false;
  }
  const qualityTarget = Math.max(0, Math.min(100, params.qualityTarget ?? 93));
  return (
    !sample.productionReady ||
    !sample.rpcReady ||
    !sample.dashboardReady ||
    sample.productionScore < qualityTarget ||
    sample.safetyViolations > 0 ||
    sample.blockers.length > 0
  );
}

export function toSelfImprovementSoakInput(
  receipt: SelfImprovementSoakReceipt,
  checkedAt: number,
): SelfImprovementSoakInput {
  const parsed = parseSelfImprovementSoakReceipt(receipt);
  return {
    candidateReleaseId: parsed.candidateReleaseId,
    startedAt: parsed.startedAt,
    checkedAt,
    samples: parsed.samples,
    managedRestartReleaseIds: parsed.managedRestartReleaseIds,
    rollbackVerified: Boolean(parsed.rollbackEvidence.sha256),
  };
}

export function evaluateSelfImprovementSoakReceipt(
  receipt: SelfImprovementSoakReceipt,
  checkedAt: number,
): SelfImprovementSoakEvaluation {
  return evaluateSelfImprovementProductionSoak(toSelfImprovementSoakInput(receipt, checkedAt));
}

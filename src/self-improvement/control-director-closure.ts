// Proof-backed SIG closure and recurrence reopening for Control Director journeys.
import { buildControlDirectorJudgeClaimHash } from "../agents/control-director-contract.js";
import type { IndependentJudgeReceipt } from "../agents/independent-judge-service.js";
import { verifyJudgeReceipt } from "../agents/judge-receipt-signer.js";
import type { PursueGoalJudgeReceipt } from "../tasks/pursue-goal-controller-state.js";
import type { ControlDirectorJourneyClosure } from "./control-director-closure.types.js";
import type { ControlDirectorJourneySignalCode } from "./control-director-journeys.js";
import type { SelfImprovementProofReceipt } from "./proof-receipts.js";

export type { ControlDirectorJourneyClosure } from "./control-director-closure.types.js";

type JudgeClosureReceipt = IndependentJudgeReceipt | PursueGoalJudgeReceipt;

export type ControlDirectorJourneyClosureDecision =
  | { ready: true; closure: ControlDirectorJourneyClosure }
  | {
      ready: false;
      code:
        | "owner_missing"
        | "sla_missing"
        | "observation_too_short"
        | "recurrence_target_missed"
        | "recurrence_during_observation"
        | "proof_not_bound"
        | "proof_failed"
        | "judge_not_bound"
        | "judge_invalid";
      reason: string;
    };

export function evaluateControlDirectorJourneyClosure(params: {
  recommendationId: string;
  signalCode: ControlDirectorJourneySignalCode;
  owner: string;
  slaAt: number;
  observation: { startedAt: number; endedAt: number; minimumDurationMs: number };
  recurrenceCount: number;
  targetRecurrenceCount?: number;
  lastRecurrenceAt?: number;
  proofReceipt: SelfImprovementProofReceipt;
  judgeReceipt: JudgeClosureReceipt;
  verifyJudge?: (receipt: JudgeClosureReceipt) => boolean;
  now?: number;
}): ControlDirectorJourneyClosureDecision {
  if (!params.owner.trim()) {
    return {
      ready: false,
      code: "owner_missing",
      reason: "Closure requires one accountable owner.",
    };
  }
  if (!Number.isFinite(params.slaAt) || params.slaAt <= 0) {
    return {
      ready: false,
      code: "sla_missing",
      reason: "Closure requires a finite SLA timestamp.",
    };
  }
  if (
    params.observation.endedAt < params.observation.startedAt ||
    params.observation.endedAt - params.observation.startedAt < params.observation.minimumDurationMs
  ) {
    return {
      ready: false,
      code: "observation_too_short",
      reason: "The required observation window has not elapsed.",
    };
  }
  const target = params.targetRecurrenceCount ?? 0;
  if (params.recurrenceCount > target) {
    return {
      ready: false,
      code: "recurrence_target_missed",
      reason: "The journey still exceeds its recurrence target.",
    };
  }
  if (
    params.lastRecurrenceAt !== undefined &&
    params.lastRecurrenceAt >= params.observation.startedAt
  ) {
    return {
      ready: false,
      code: "recurrence_during_observation",
      reason: "The journey recurred during the proof observation window.",
    };
  }
  if (params.proofReceipt.recommendationId !== params.recommendationId) {
    return {
      ready: false,
      code: "proof_not_bound",
      reason: "Outcome proof belongs to another recommendation.",
    };
  }
  if (
    params.proofReceipt.observation.startedAt !== params.observation.startedAt ||
    params.proofReceipt.observation.endedAt !== params.observation.endedAt ||
    params.proofReceipt.observation.minimumDurationMs !== params.observation.minimumDurationMs
  ) {
    return {
      ready: false,
      code: "proof_not_bound",
      reason: "Outcome proof observation does not match the requested closure window.",
    };
  }
  if (params.proofReceipt.status !== "passed" || !params.proofReceipt.outcomeConfirmed) {
    return { ready: false, code: "proof_failed", reason: "Outcome proof is not confirmed." };
  }
  const missionId = `sig:${params.recommendationId}`;
  const requestBody = `${params.signalCode} must remain at or below ${target} recurrences.`;
  const finalText = `Observed ${params.recurrenceCount} recurrences for ${params.owner}.`;
  const evidenceSummary = `Proof receipt ${params.proofReceipt.id}; observation ${params.observation.startedAt}-${params.observation.endedAt}.`;
  const claimHash = buildControlDirectorJudgeClaimHash({
    missionId,
    requestBody,
    finalText,
    evidenceSummary,
    artifactIds: [params.proofReceipt.id],
  });
  if (
    params.judgeReceipt.verdict !== "APPROVE" ||
    params.judgeReceipt.missionId !== missionId ||
    params.judgeReceipt.claimHash !== claimHash
  ) {
    return {
      ready: false,
      code: "judge_not_bound",
      reason: "Judge receipt is not bound to the exact closure claim.",
    };
  }
  if (!(params.verifyJudge ?? ((receipt) => verifyJudgeReceipt(receipt)))(params.judgeReceipt)) {
    return { ready: false, code: "judge_invalid", reason: "Judge signature is invalid." };
  }
  const closedAt = params.now ?? Date.now();
  return {
    ready: true,
    closure: {
      schemaVersion: 1,
      recommendationId: params.recommendationId,
      signalCode: params.signalCode,
      owner: params.owner.trim(),
      slaAt: params.slaAt,
      observation: { ...params.observation },
      recurrenceCount: params.recurrenceCount,
      targetRecurrenceCount: target,
      ...(params.lastRecurrenceAt !== undefined
        ? { lastRecurrenceAt: params.lastRecurrenceAt }
        : {}),
      proofReceiptId: params.proofReceipt.id,
      judgeReceiptId: params.judgeReceipt.receiptId,
      closedAt,
      status: "closed",
    },
  };
}

export function reopenControlDirectorJourneyClosure(params: {
  closure: ControlDirectorJourneyClosure;
  recurrenceAt: number;
  evidenceRef: string;
}): ControlDirectorJourneyClosure {
  if (params.recurrenceAt <= params.closure.closedAt) {
    return params.closure;
  }
  return {
    ...params.closure,
    status: "reopened",
    lastRecurrenceAt: params.recurrenceAt,
    recurrenceCount: params.closure.recurrenceCount + 1,
    reopenReason: `Journey recurred after closure: ${params.evidenceRef.slice(0, 240)}`,
  };
}

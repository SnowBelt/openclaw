import { describe, expect, it } from "vitest";
import { buildControlDirectorJudgeClaimHash } from "../agents/control-director-contract.js";
import type { IndependentJudgeReceipt } from "../agents/independent-judge-service.js";
import {
  evaluateControlDirectorJourneyClosure,
  reopenControlDirectorJourneyClosure,
} from "./control-director-closure.js";
import type { SelfImprovementProofReceipt } from "./proof-receipts.js";

const proof: SelfImprovementProofReceipt = {
  id: "proof-1",
  version: 1,
  recommendationId: "recommendation-1",
  diagnosis: "Delivery miss",
  action: "Repair delivery reconciliation",
  metric: { name: "misses", target: "0", observed: "0", passed: true },
  observation: { startedAt: 100, endedAt: 200, minimumDurationMs: 100 },
  holdout: { required: true, passed: true },
  evidenceRefs: ["test:delivery"],
  status: "passed",
  outcomeConfirmed: true,
  createdAt: 200,
  verifiedAt: 200,
};

function judgeReceipt(): IndependentJudgeReceipt {
  const missionId = "sig:recommendation-1";
  const requestBody = "delivery_miss must remain at or below 0 recurrences.";
  const finalText = "Observed 0 recurrences for delivery-runtime.";
  const evidenceSummary = "Proof receipt proof-1; observation 100-200.";
  return {
    schemaVersion: 1,
    receiptId: "judge-1",
    missionId,
    claimHash: buildControlDirectorJudgeClaimHash({
      missionId,
      requestBody,
      finalText,
      evidenceSummary,
      artifactIds: [proof.id],
    }),
    verdict: "APPROVE",
    scope: "exact closure",
    evidenceSummary,
    conditions: "none",
    judgeRunId: "judge-run",
    judgeAgentId: "judge",
    issuedAt: 200,
    signature: "test-signature",
    publicKeyId: "test-key",
  };
}

describe("Control Director SIG closure governance", () => {
  it("requires proof, observation, owner, SLA, recurrence target, and independent Judge", () => {
    const result = evaluateControlDirectorJourneyClosure({
      recommendationId: "recommendation-1",
      signalCode: "delivery_miss",
      owner: "delivery-runtime",
      slaAt: 500,
      observation: { startedAt: 100, endedAt: 200, minimumDurationMs: 100 },
      recurrenceCount: 0,
      proofReceipt: proof,
      judgeReceipt: judgeReceipt(),
      verifyJudge: () => true,
      now: 250,
    });
    expect(result).toMatchObject({
      ready: true,
      closure: { status: "closed", proofReceiptId: "proof-1", judgeReceiptId: "judge-1" },
    });
  });

  it("fails closed on recurrence or unbound Judge proof and reopens future recurrence", () => {
    expect(
      evaluateControlDirectorJourneyClosure({
        recommendationId: "recommendation-1",
        signalCode: "delivery_miss",
        owner: "delivery-runtime",
        slaAt: 500,
        observation: { startedAt: 100, endedAt: 200, minimumDurationMs: 100 },
        recurrenceCount: 1,
        proofReceipt: proof,
        judgeReceipt: judgeReceipt(),
        verifyJudge: () => true,
      }),
    ).toMatchObject({ ready: false, code: "recurrence_target_missed" });

    const closed = evaluateControlDirectorJourneyClosure({
      recommendationId: "recommendation-1",
      signalCode: "delivery_miss",
      owner: "delivery-runtime",
      slaAt: 500,
      observation: { startedAt: 100, endedAt: 200, minimumDurationMs: 100 },
      recurrenceCount: 0,
      proofReceipt: proof,
      judgeReceipt: judgeReceipt(),
      verifyJudge: () => true,
      now: 250,
    });
    if (!closed.ready) {
      throw new Error(closed.reason);
    }
    expect(
      reopenControlDirectorJourneyClosure({
        closure: closed.closure,
        recurrenceAt: 300,
        evidenceRef: "runtime:delivery-miss-2",
      }),
    ).toMatchObject({ status: "reopened", recurrenceCount: 1 });
  });
});

// Independent, claim-bound Judge execution for completion decisions.
import crypto from "node:crypto";
import { judgeTaskCompletion } from "../tasks/task-completion-judge.js";
import { buildControlDirectorJudgeClaimHash } from "./control-director-contract.js";
import {
  formatJudgeVerdict,
  parseJudgeCompletionVerdict,
  type JudgeGateVerdict,
} from "./judge-gate.js";
import { signJudgeReceipt } from "./judge-receipt-signer.js";

export type IndependentJudgeReceipt = {
  schemaVersion: 1;
  receiptId: string;
  missionId: string;
  claimHash: string;
  verdict: "APPROVE" | "REJECT" | "REQUEST_MORE_EVIDENCE" | "ESCALATE_TO_HUMAN";
  scope: string;
  evidenceSummary: string;
  conditions: string;
  judgeRunId: string;
  judgeAgentId: string;
  model?: string;
  issuedAt: number;
  signature?: string;
  publicKeyId?: string;
};

export type IndependentJudgeModelResult = {
  text: string;
  runId: string;
  agentId: string;
  model?: string;
};

export type IndependentJudgeResult = {
  approved: boolean;
  receipt: IndependentJudgeReceipt;
  deterministicVerdict: JudgeGateVerdict;
  modelText?: string;
};

function normalizeJudgeVerdict(value: string): IndependentJudgeReceipt["verdict"] {
  return value === "APPROVE" ||
    value === "REJECT" ||
    value === "REQUEST_MORE_EVIDENCE" ||
    value === "ESCALATE_TO_HUMAN"
    ? value
    : "REQUEST_MORE_EVIDENCE";
}

function buildJudgePrompt(params: {
  missionId: string;
  requestBody: string;
  finalText: string;
  evidenceSummary: string;
  claimHash: string;
  deterministicVerdict: JudgeGateVerdict;
}): string {
  return [
    "You are the independent completion Judge. Do not execute or modify anything.",
    "Evaluate only the exact mission, claim, and direct evidence below.",
    "Return exactly six non-empty lines: VERDICT, SCOPE, EVIDENCE, RISK, REASON, CONDITIONS.",
    "VERDICT must be APPROVE, REJECT, REQUEST_MORE_EVIDENCE, or ESCALATE_TO_HUMAN.",
    "Approve only when every requested outcome is supported by direct evidence.",
    "",
    `Mission id: ${params.missionId}`,
    `Claim hash: ${params.claimHash}`,
    `Original request: ${params.requestBody}`,
    `Proposed final answer: ${params.finalText}`,
    `Direct evidence: ${params.evidenceSummary}`,
    "Deterministic packet preflight (not the final verdict):",
    formatJudgeVerdict(params.deterministicVerdict),
  ].join("\n");
}

function unsignedReceipt(params: {
  missionId: string;
  claimHash: string;
  verdict: IndependentJudgeReceipt["verdict"];
  scope: string;
  evidenceSummary: string;
  conditions: string;
  judgeRunId: string;
  judgeAgentId: string;
  model?: string;
  now: number;
}): IndependentJudgeReceipt {
  return {
    schemaVersion: 1,
    receiptId: crypto.randomUUID(),
    missionId: params.missionId,
    claimHash: params.claimHash,
    verdict: params.verdict,
    scope: params.scope,
    evidenceSummary: params.evidenceSummary,
    conditions: params.conditions,
    judgeRunId: params.judgeRunId,
    judgeAgentId: params.judgeAgentId,
    issuedAt: params.now,
    ...(params.model ? { model: params.model } : {}),
  };
}

/** Run deterministic preflight plus a separate model Judge, then sign the exact claim receipt. */
export async function judgeCompletionIndependently(params: {
  missionId: string;
  requestBody: string;
  finalText: string;
  evidenceSummary: string;
  artifactIds?: readonly string[];
  runModel?: (prompt: string) => Promise<IndependentJudgeModelResult>;
  signingDirectory?: string;
  now?: number;
}): Promise<IndependentJudgeResult> {
  const now = params.now ?? Date.now();
  const claimHash = buildControlDirectorJudgeClaimHash({
    missionId: params.missionId,
    requestBody: params.requestBody,
    finalText: params.finalText,
    evidenceSummary: params.evidenceSummary,
    artifactIds: params.artifactIds,
  });
  const deterministic = judgeTaskCompletion({
    userRequest: params.requestBody,
    finalText: params.finalText,
    expectedDeliverable: "exact Pursue Goal mission",
    artifactIds: params.artifactIds,
    status: "succeeded",
  });
  if (!deterministic.approved || !params.runModel) {
    const unsigned = unsignedReceipt({
      missionId: params.missionId,
      claimHash,
      verdict: deterministic.approved
        ? "REQUEST_MORE_EVIDENCE"
        : normalizeJudgeVerdict(deterministic.verdict.verdict),
      scope: deterministic.verdict.scope,
      evidenceSummary: deterministic.verdict.evidence,
      conditions: params.runModel
        ? deterministic.verdict.conditions
        : "configure an independent Judge agent and rerun verification",
      judgeRunId: "not-run",
      judgeAgentId: "unavailable",
      now,
    });
    const receipt = signJudgeReceipt(unsigned, { directory: params.signingDirectory });
    return { approved: false, receipt, deterministicVerdict: deterministic.verdict };
  }

  const modelResult = await params.runModel(
    buildJudgePrompt({
      missionId: params.missionId,
      requestBody: params.requestBody,
      finalText: params.finalText,
      evidenceSummary: params.evidenceSummary,
      claimHash,
      deterministicVerdict: deterministic.verdict,
    }),
  );
  const parsed = parseJudgeCompletionVerdict(modelResult.text);
  const parsedVerdict =
    parsed.status === "parsed" ? normalizeJudgeVerdict(parsed.verdict) : "REQUEST_MORE_EVIDENCE";
  const unsigned = unsignedReceipt({
    missionId: params.missionId,
    claimHash,
    verdict: parsedVerdict,
    scope: parsed.status === "parsed" ? parsed.scope : "exact Pursue Goal mission",
    evidenceSummary:
      parsed.status === "parsed"
        ? parsed.evidence
        : "Judge response did not match the six-line contract.",
    conditions:
      parsed.status === "parsed" ? parsed.conditions : parsed.errors.join("; ") || "rerun Judge",
    judgeRunId: modelResult.runId,
    judgeAgentId: modelResult.agentId,
    model: modelResult.model,
    now,
  });
  const receipt = signJudgeReceipt(unsigned, { directory: params.signingDirectory });
  return {
    approved: parsedVerdict === "APPROVE",
    receipt,
    deterministicVerdict: deterministic.verdict,
    modelText: modelResult.text,
  };
}

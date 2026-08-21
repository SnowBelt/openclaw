import { isJudgeOutOfScopeText, type JudgeTrustedEvidence } from "../agents/judge-contract.js";
import {
  buildJudgeVerdict,
  formatJudgeVerdict,
  type JudgeGateVerdict,
} from "../agents/judge-gate.js";

type JudgeTaskCompletionParams = {
  userRequest: string;
  finalText?: string;
  expectedDeliverable?: string;
  artifactIds?: readonly string[];
  status: "succeeded" | "failed" | "timed_out" | "cancelled";
  error?: string;
  trustedEvidence?: readonly JudgeTrustedEvidence[];
};

export type TaskCompletionJudgeResult = {
  approved: boolean;
  verdict: JudgeGateVerdict;
  artifactIds: string[];
  blockedReason?: string;
};

const WORKING_ONLY_RE =
  /\b(i'?m|i am|we'?re|we are|still|will|going to|let me|checking|working|started|starting|in progress|look into|follow up)\b/i;
const COMPLETION_RE =
  /\b(done|complete|completed|finished|ready|attached|created|built|delivered|here(?:'s| is))\b/i;
const ARTIFACT_REQUEST_RE =
  /\b(video|game|rom|file|download|attachment|image|picture|photo|song|music|audio|pdf|docx|spreadsheet|presentation|app|project|artifact)\b/i;
const CONCRETE_OUTCOME_REQUEST_RE =
  /\b(?:implement|fix|repair|change|modify|update|build|create|configure|install|remove|delete|deploy|write|edit|patch|test|verify|validate|audit|prove|run)\b/i;

function trimText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function inferExpectedDeliverable(params: JudgeTaskCompletionParams): string {
  return (
    trimText(params.expectedDeliverable) ||
    (ARTIFACT_REQUEST_RE.test(params.userRequest) ? "requested artifact" : "direct answer")
  );
}

function isWorkingOnlyFinal(text: string): boolean {
  return WORKING_ONLY_RE.test(text) && !COMPLETION_RE.test(text);
}

export function judgeTaskCompletion(params: JudgeTaskCompletionParams): TaskCompletionJudgeResult {
  const finalText = trimText(params.finalText);
  const expectedDeliverable = inferExpectedDeliverable(params);
  const artifactIds = [...new Set((params.artifactIds ?? []).map(trimText).filter(Boolean))];
  const trustedEvidence = [...(params.trustedEvidence ?? [])].filter(
    (record): record is JudgeTrustedEvidence =>
      typeof record.id === "string" &&
      Boolean(record.id.trim()) &&
      typeof record.kind === "string" &&
      typeof record.summary === "string" &&
      Boolean(record.summary.trim()),
  );
  const trustedEvidenceProvided = params.trustedEvidence !== undefined;
  const wantsArtifact =
    ARTIFACT_REQUEST_RE.test(params.userRequest) || ARTIFACT_REQUEST_RE.test(expectedDeliverable);
  const requiresConcreteOutcomeEvidence = CONCRETE_OUTCOME_REQUEST_RE.test(
    `${params.userRequest} ${expectedDeliverable}`,
  );
  const hasSuccessfulWorkerExecution = trustedEvidence.some(
    (record) =>
      record.kind === "worker_execution" &&
      /\bsuccessful\b/i.test(record.summary) &&
      /\btoolCalls=[1-9]\d*\b/u.test(record.summary) &&
      /\btoolFailures=0\b/u.test(record.summary),
  );
  const hasConcreteOutcomeEvidence =
    hasSuccessfulWorkerExecution ||
    trustedEvidence.some(
      (record) =>
        record.kind === "artifact_digest" ||
        record.kind === "source_observation" ||
        record.kind === "config_observation",
    );
  const evidence = [
    `runtime status: ${params.status}`,
    params.error ? `error: ${params.error}` : undefined,
    trustedEvidence.length
      ? `trusted evidence: ${trustedEvidence
          .map((record) => `${record.id}=${record.summary}`)
          .join("; ")}`
      : "trusted evidence: none",
    artifactIds.length ? `artifact refs: ${artifactIds.join(", ")}` : "artifact refs: none",
  ]
    .filter(Boolean)
    .join("; ");

  let forcedVerdict: JudgeGateVerdict | undefined;
  if (params.status !== "succeeded") {
    forcedVerdict = buildJudgeVerdict({
      verdict: "REJECT",
      scope: expectedDeliverable,
      evidence,
      risk: "low",
      reason: "The runtime did not finish successfully.",
      conditions: "resolve the failed runtime status",
      gate: "task_completion",
    });
  } else if (!finalText) {
    forcedVerdict = buildJudgeVerdict({
      verdict: "REQUEST_MORE_EVIDENCE",
      scope: expectedDeliverable,
      evidence,
      risk: "low",
      reason: "There is no final user-visible reply.",
      conditions: "provide a final answer or explicit blocker",
      gate: "task_completion",
    });
  } else if (isWorkingOnlyFinal(finalText)) {
    forcedVerdict = buildJudgeVerdict({
      verdict: "REQUEST_MORE_EVIDENCE",
      scope: expectedDeliverable,
      evidence,
      risk: "low",
      reason: "The final reply only promises future work.",
      conditions: "finish the work or record a concrete blocker",
      gate: "task_completion",
    });
  } else if (isJudgeOutOfScopeText(params.userRequest)) {
    forcedVerdict = buildJudgeVerdict({
      verdict: "OUT_OF_SCOPE",
      scope: expectedDeliverable,
      evidence,
      risk: "unclear",
      reason: "The request asks for a normative moral or ethical judgment outside Judge scope.",
      conditions: "restate the request as technical completion or operational verification",
      gate: "task_completion",
    });
  } else if (wantsArtifact && artifactIds.length === 0) {
    forcedVerdict = buildJudgeVerdict({
      verdict: "REQUEST_MORE_EVIDENCE",
      scope: expectedDeliverable,
      evidence,
      risk: "low",
      reason: "The request expected an artifact but no artifact was recorded.",
      conditions: "attach or link the requested artifact",
      gate: "task_completion",
    });
  } else if (
    trustedEvidenceProvided &&
    (!trustedEvidence.some((record) => record.kind === "runtime_completion") ||
      (requiresConcreteOutcomeEvidence && !hasConcreteOutcomeEvidence) ||
      (wantsArtifact && !trustedEvidence.some((record) => record.kind === "artifact_digest")))
  ) {
    forcedVerdict = buildJudgeVerdict({
      verdict: "REQUEST_MORE_EVIDENCE",
      scope: expectedDeliverable,
      evidence: "runtime status succeeded; required trusted execution evidence was not recorded",
      risk: "low",
      reason: "The completion claim has no complete controller-observed evidence packet.",
      conditions: "record trusted runtime, execution, and artifact evidence and rerun verification",
      gate: "task_completion",
    });
  }

  const verdict =
    forcedVerdict ??
    buildJudgeVerdict({
      verdict: "APPROVE",
      scope: expectedDeliverable,
      evidence,
      risk: "low",
      reason:
        "The runtime completed and the deliverable is ready for independent technical review.",
      conditions: "independent model review must verify the exact claim",
      gate: "task_completion",
    });
  const approved = verdict.verdict === "APPROVE";
  return {
    approved,
    verdict,
    artifactIds,
    ...(approved ? {} : { blockedReason: formatJudgeVerdict(verdict) }),
  };
}

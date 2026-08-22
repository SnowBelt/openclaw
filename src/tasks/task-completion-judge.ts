import {
  isJudgeOutOfScopeText,
  isJudgeTrustedEvidenceComplete,
  JUDGE_TRUSTED_EVIDENCE_KINDS,
  type JudgeTrustedEvidence,
} from "../agents/judge-contract.js";
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
// Media/export deliverables need an attached byte-level artifact. Software,
// source files, apps, games, and projects instead require mutation plus
// behavioral verification; a generic noun must never turn into an artifact
// bypass.
const ARTIFACT_REQUEST_RE =
  /\b(?:video(?!\s+game\b)|image|picture|photo|song|music|audio|pdf|docx|spreadsheet|presentation)\b|\b(?:file|app|project|artifact|rom|game)\b[^.?!\n]{0,80}\b(?:attach|attached|download|downloadable|deliver|delivered|export|provide|return|send|upload)\b|\b(?:attach|attached|download|downloadable|deliver|delivered|export|provide|return|send|upload)\b[^.?!\n]{0,80}\b(?:file|app|project|artifact|rom|game)\b/i;
const CONCRETE_OUTCOME_REQUEST_RE =
  /\b(?:implement|fix|repair|change|modify|update|build|create|configure|install|remove|delete|deploy|write|edit|patch|test|verify|validate|audit|prove|run)\b/i;
const INSPECTION_REQUEST_RE =
  /\b(?:audit|inspect|review|analy[sz]e|check|assess|evaluate|verify|validate|prove)\b/i;
const MUTATION_REQUEST_RE =
  /\b(?:implement|fix|repair|change|modify|update|build|create|configure|install|remove|delete|deploy|write|edit|patch)\b/i;

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
      JUDGE_TRUSTED_EVIDENCE_KINDS.includes(
        record.kind as (typeof JUDGE_TRUSTED_EVIDENCE_KINDS)[number],
      ) &&
      typeof record.summary === "string" &&
      Boolean(record.summary.trim()) &&
      isJudgeTrustedEvidenceComplete(record),
  );
  const trustedEvidenceProvided = params.trustedEvidence !== undefined;
  const wantsArtifact =
    ARTIFACT_REQUEST_RE.test(params.userRequest) || ARTIFACT_REQUEST_RE.test(expectedDeliverable);
  const artifactOnlyRequest =
    wantsArtifact &&
    !/\b(?:fix|repair|change|modify|update|configure|install|remove|delete|deploy|write|edit|patch|test|verify|validate|audit|prove)\b/i.test(
      `${params.userRequest} ${expectedDeliverable}`,
    );
  const requiresArtifact = artifactOnlyRequest;
  const hasMutationIntent = MUTATION_REQUEST_RE.test(
    `${params.userRequest} ${expectedDeliverable}`,
  );
  const requiresInspectionEvidence =
    !artifactOnlyRequest &&
    !hasMutationIntent &&
    INSPECTION_REQUEST_RE.test(`${params.userRequest} ${expectedDeliverable}`);
  const requiresConcreteOutcomeEvidence =
    !artifactOnlyRequest &&
    !requiresInspectionEvidence &&
    CONCRETE_OUTCOME_REQUEST_RE.test(`${params.userRequest} ${expectedDeliverable}`);
  const requiresMutationAndVerification =
    requiresConcreteOutcomeEvidence && !artifactOnlyRequest && hasMutationIntent;
  // Tool activity is not an outcome. A successful read/update_goal call can
  // never prove that an implementation, test, or deployment claim happened.
  // Require a content-, source-, or configuration-bound observation instead.
  const hasConcreteOutcomeEvidence = trustedEvidence.some(
    (record) =>
      (artifactOnlyRequest && record.kind === "artifact_digest") ||
      (record.kind === "source_mutation" && isJudgeTrustedEvidenceComplete(record)) ||
      (record.kind === "test_execution" && isJudgeTrustedEvidenceComplete(record)) ||
      (record.kind === "config_mutation" && isJudgeTrustedEvidenceComplete(record)),
  );
  const hasInspectionEvidence = trustedEvidence.some(
    (record) =>
      record.kind === "source_observation" ||
      record.kind === "config_observation" ||
      record.kind === "test_execution",
  );
  const hasMutationEvidence =
    trustedEvidence.some(
      (record) =>
        (record.kind === "source_mutation" || record.kind === "config_mutation") &&
        isJudgeTrustedEvidenceComplete(record),
    ) ||
    (artifactOnlyRequest && trustedEvidence.some((record) => record.kind === "artifact_digest"));
  const hasVerificationEvidence = trustedEvidence.some(
    (record) =>
      (record.kind === "test_execution" ||
        (artifactOnlyRequest && record.kind === "artifact_digest")) &&
      isJudgeTrustedEvidenceComplete(record),
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
  } else if (requiresArtifact && artifactIds.length === 0) {
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
    (trustedEvidenceProvided || requiresConcreteOutcomeEvidence || requiresInspectionEvidence) &&
    (!trustedEvidence.some((record) => record.kind === "runtime_completion") ||
      (requiresConcreteOutcomeEvidence && !hasConcreteOutcomeEvidence) ||
      (requiresInspectionEvidence && !hasInspectionEvidence) ||
      (requiresMutationAndVerification && (!hasMutationEvidence || !hasVerificationEvidence)) ||
      (requiresArtifact && !trustedEvidence.some((record) => record.kind === "artifact_digest")))
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

export const CURATOR_REVIEW_TIMEOUT_MS = 180_000;

export const CURATOR_REVIEW_SYSTEM_PROMPT =
  "Internal event-driven reviewer task. Use the memory-knowledge-curator skill. Complete one bounded review and record the decision with curator_decide; never use promotion or write actions.";

export function buildCuratorReviewSessionKey(
  proposalId: string,
  attempt: number,
  runId = "run",
): string {
  return `agent:memory-knowledge-curator:curator-review:${proposalId}:attempt-${attempt}:${runId}`;
}

export function createCuratorReviewTask(proposalId: string): {
  message: string;
  extraSystemPrompt: string;
  timeoutMs: number;
} {
  return {
    message: [
      `Review memory/skill proposal ${proposalId}.`,
      "Call curator_get for this proposal, inspect only its cited evidence,",
      "then call curator_decide exactly once.",
      "Do not promote, write, or disclose private content.",
    ].join(" "),
    extraSystemPrompt: CURATOR_REVIEW_SYSTEM_PROMPT,
    timeoutMs: CURATOR_REVIEW_TIMEOUT_MS,
  };
}

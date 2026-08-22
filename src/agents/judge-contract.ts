import crypto from "node:crypto";

/**
 * The model-facing Judge contract.
 *
 * This is deliberately narrower than the agent-role capability contract. The
 * Judge may read the evidence it is given, but its model turn is a zero-tool,
 * single-request technical verifier. Ethics, morality, politics, and value
 * judgments are outside that contract and must never be converted into an
 * approval decision.
 */

export const JUDGE_CONTRACT_VERSION = 2 as const;
export const JUDGE_HOSTED_MODEL = "openai/gpt-5.6" as const;
export const JUDGE_MODEL_TOOL_ALLOWLIST = [] as const;
export const JUDGE_MODEL_REQUEST_COUNT = 1 as const;
export const JUDGE_REQUEST_MAX_CHARS = 16_000;
export const JUDGE_FINAL_TEXT_MAX_CHARS = 64_000;
export const JUDGE_EVIDENCE_MAX_CHARS = 32_000;
export const JUDGE_ARTIFACT_MAX_COUNT = 32;
export const JUDGE_ARTIFACT_ID_MAX_CHARS = 2_048;
export const JUDGE_PROMPT_MAX_BYTES = 128 * 1024;
export const JUDGE_RESPONSE_MAX_BYTES = 32 * 1024;
export const JUDGE_RESPONSE_FIELD_MAX_CHARS = 4_096;
export const JUDGE_MAX_OUTPUT_TOKENS = 4_096;

export const JUDGE_V2_VERDICTS = [
  "APPROVE",
  "REJECT",
  "NEEDS_EVIDENCE",
  "OUT_OF_SCOPE",
  "OWNER_APPROVAL_REQUIRED",
  "SYSTEM_ERROR",
] as const;

export const JUDGE_V2_RISKS = ["low", "medium", "high", "prohibited", "unclear"] as const;

/**
 * Provider-native structured-output schema.  The schema is intentionally
 * closed: a hosted provider must not be able to smuggle tool plans or other
 * control-plane fields into a Judge response.
 */
export const JUDGE_V2_RESPONSE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: [...JUDGE_V2_VERDICTS] },
    scope: { type: "string", minLength: 1, maxLength: JUDGE_RESPONSE_FIELD_MAX_CHARS },
    evidence: { type: "string", minLength: 1, maxLength: JUDGE_RESPONSE_FIELD_MAX_CHARS },
    risk: { type: "string", enum: [...JUDGE_V2_RISKS] },
    reason: { type: "string", minLength: 1, maxLength: JUDGE_RESPONSE_FIELD_MAX_CHARS },
    conditions: { type: "string", minLength: 1, maxLength: JUDGE_RESPONSE_FIELD_MAX_CHARS },
  },
  required: ["verdict", "scope", "evidence", "risk", "reason", "conditions"],
} as const;

export type JudgeV2Verdict = (typeof JUDGE_V2_VERDICTS)[number];
export type JudgeV2Risk = (typeof JUDGE_V2_RISKS)[number];

export type JudgeV2ModelOutput = {
  verdict: JudgeV2Verdict;
  scope: string;
  evidence: string;
  risk: JudgeV2Risk;
  reason: string;
  conditions: string;
};

export type JudgeModelExecutionEvidence = {
  requestCount: number;
  modelVisibleTools: readonly string[];
  route: "local" | "hosted" | "unknown";
  model: string;
};

/** Evidence observed by the controller, never asserted by worker prose. */
export const JUDGE_TRUSTED_EVIDENCE_KINDS = [
  "runtime_completion",
  "worker_execution",
  "artifact_digest",
  "source_observation",
  "source_mutation",
  "test_execution",
  "config_observation",
  "config_mutation",
] as const;
export type JudgeTrustedEvidenceKind = (typeof JUDGE_TRUSTED_EVIDENCE_KINDS)[number];
export type JudgeTrustedEvidence = {
  id: string;
  kind: JudgeTrustedEvidenceKind;
  summary: string;
  /** SHA-256 of the redacted terminal result, when evidence came from a tool. */
  resultDigest?: string;
  /** SHA-256 of the guarded post-state for a mutation, when available. */
  postStateDigest?: string;
};
export const JUDGE_TRUSTED_EVIDENCE_MAX_COUNT = 32;
export const JUDGE_TRUSTED_EVIDENCE_ID_MAX_CHARS = 128;
export const JUDGE_TRUSTED_EVIDENCE_SUMMARY_MAX_CHARS = 2_048;
export const JUDGE_SHA256_HEX_RE = /^[a-f0-9]{64}$/iu;

/**
 * Evidence kinds that attest an effect have stronger requirements than a
 * read-only observation. Keeping this predicate in the protocol module makes
 * every ingress (runtime, persistence, and Judge request validation) use the
 * same fail-closed rule.
 */
export function isJudgeTrustedEvidenceComplete(record: JudgeTrustedEvidence): boolean {
  const validDigest = (value: unknown): value is string =>
    typeof value === "string" && JUDGE_SHA256_HEX_RE.test(value);
  if (record.kind === "source_mutation" || record.kind === "config_mutation") {
    return validDigest(record.resultDigest) && validDigest(record.postStateDigest);
  }
  if (record.kind === "test_execution") {
    return validDigest(record.resultDigest);
  }
  return true;
}

export function judgeTrustedEvidenceReferenceList(
  records: readonly JudgeTrustedEvidence[],
): string {
  return records
    .map((record) => record.id)
    .toSorted()
    .join(", ");
}

const NEGATED_NORMATIVE_INSTRUCTION =
  /\b(?:never|not|don't|doesn't|cannot|can't|do not|must not|should not|without|prevent|avoid|keep)\b[^.?!\n]{0,120}\b(?:judge|decide|assess|evaluate|determine)\b[^.?!\n]{0,120}\b(?:ethical|ethics|moral|morality|right|wrong|values?)\b/i;
const TECHNICAL_BOUNDARY_INSTRUCTION =
  /\b(?:implement|add|write|test|verify|ensure|prevent|make|configure|build|fix|repair|guard|enforce|confirm|assert)\b[^.?!\n]{0,180}\b(?:judge|model|system|guard)\b[^.?!\n]{0,180}\b(?:never|not|doesn't|does not|refuse|refuses|reject|rejects|block|blocks|avoid|prevent)\b[^.?!\n]{0,180}\b(?:ethical|ethics|moral|morality|right|wrong|values?)\b/i;
const OUT_OF_SCOPE_PATTERNS = [
  /^\s*(?:is|are|was|were|should|would)\b[^.?!\n]{0,160}\b(?:ethical|unethical|moral|immoral|morally|ethically|right|wrong)\b\s*\??\s*$/i,
  /\b(?:is this|was this|are these|should i|did i)\b[^.?!\n]{0,160}\b(?:ethical|unethical|moral|immoral|morally|ethically|right|wrong)\b/i,
  /\b(?:decid(?:e|ing)|tell me|assess|evaluat(?:e|ing)|determine|judg(?:e|ing))\s+(?:whether|if)\b[^.?!\n]{0,160}\b(?:ethical|unethical|moral|immoral|morally|ethically|right|wrong)\b/i,
  /\b(?:evaluate|assess|judge|determine|decide|rank|compare|choose|recommend|provide|give|tell me|explain)\b[^.?!\n]{0,160}\b(?:the\s+)?(?:ethic(?:s|al)|unethical|moral(?:ity|ly)?|immoral|right|wrong|values?)\b/i,
  /\bwhich\b[^.?!\n]{0,160}\b(?:more\s+)?(?:ethical|moral|right|wrong)\b/i,
  /\b(?:should\s+i|should\s+we|who\s+should\s+i|which\s+candidate|which\s+party|what\s+party|how\s+should\s+i\s+vote|who\s+do\s+i\s+vote\s+for)\b[^.?!\n]{0,180}\b(?:politic(?:al|s)?|election|vote|voting|ballot|campaign|party|president|senator|governor|mayor|support|elect|choose)\b/i,
  /\b(?:analy[sz]e|discuss|debate|explain|explore|evaluate|assess|judge|determine|decide|rank|compare|recommend|tell me)\b[^.?!\n]{0,180}\b(?:politic(?:al|s)?|election|vote|voting|ballot|campaign|party|president|senator|governor|mayor)\b/i,
  /\b(?:which|who)\b[^.?!\n]{0,120}\bcandidate\b[^.?!\n]{0,80}\b(?:support|vote|elect|choose)\b/i,
  /\b(?:what|who)\b[^.?!\n]{0,120}\b(?:is|are)\b[^.?!\n]{0,120}\b(?:ethical|unethical|moral|immoral|morally|ethically|right|wrong|values?)\b/i,
  /\b(?:analy[sz]e|discuss|debate|explain|explore|evaluate|assess|judge|determine|decide|rank|compare|recommend|tell me)\b[^.?!\n]{0,180}\b(?:morality|moral(?:ity|ly)?|ethic(?:s|al(?:ly)?)|values?|justice|fairness|politic(?:s|al)|acceptable|unacceptable|good|bad|right|wrong|just|unjust)\b/i,
  /^\s*(?:is|are|was|were|should|would)\b[^.?!\n]{0,180}\b(?:good|bad|acceptable|unacceptable|fair|unfair|just|unjust)\b\s*\??\s*$/i,
] as const;
const AMBIGUOUS_NORMATIVE_WORD_RE =
  /\b(?:good|bad|acceptable|unacceptable|fair|unfair|just|unjust|right|wrong)\b/i;
const EXPLICIT_NORMATIVE_WORD_RE =
  /\b(?:ethical|unethical|ethics|moral|morality|immoral|values?|justice|fairness|politic(?:s|al)?)\b/i;
const TECHNICAL_QUALITY_SUBJECT_RE =
  /^\s*(?:is|are|was|were|does|do|did|can|could|will|would)\s+(?:(?:the|this|that|your|our)\s+)?(?:build|test|deployment|configuration|config|receipt|code|implementation|runtime|system|model|result|output|performance|reliability|correctness|status|feature|release|goal|task|patch|artifact|software|service|endpoint|request|response|schema|typecheck|lint|command|process|tool|file|app|project)\b/i;
const TECHNICAL_CANDIDATE_CONTEXT_RE =
  /\b(?:model|release|test|patch|design|job|role|software|implementation)\s+candidate\b/i;

/** True only for explicit moral, ethical, political, or value-evaluation asks. */
export function isJudgeOutOfScopeText(...values: readonly unknown[]): boolean {
  const clauses = values
    .filter((value): value is string => typeof value === "string")
    .flatMap((value) => value.split(/[.!?;\n]+/u))
    .flatMap((clause) => clause.split(/\b(?:and|but|also|however)\b/iu))
    .map((clause) => clause.trim())
    .filter(Boolean);
  return clauses.some(
    (clause) =>
      !TECHNICAL_BOUNDARY_INSTRUCTION.test(clause) &&
      !NEGATED_NORMATIVE_INSTRUCTION.test(clause) &&
      OUT_OF_SCOPE_PATTERNS.some((pattern) => pattern.test(clause)) &&
      !(
        /\bcandidate\b[^.?!\n]{0,80}\b(?:support|vote|elect|choose)\b/i.test(clause) &&
        TECHNICAL_CANDIDATE_CONTEXT_RE.test(clause)
      ) &&
      !(
        AMBIGUOUS_NORMATIVE_WORD_RE.test(clause) &&
        !EXPLICIT_NORMATIVE_WORD_RE.test(clause) &&
        TECHNICAL_QUALITY_SUBJECT_RE.test(clause)
      ),
  );
}

/** Canonical digest for the controller-observed evidence packet. */
export function judgeTrustedEvidenceDigest(records: readonly JudgeTrustedEvidence[]): string {
  const canonical = records
    .map((record) => ({
      id: record.id,
      kind: record.kind,
      summary: record.summary,
      ...(record.resultDigest ? { resultDigest: record.resultDigest } : {}),
      ...(record.postStateDigest ? { postStateDigest: record.postStateDigest } : {}),
    }))
    .toSorted((a, b) => a.id.localeCompare(b.id));
  return crypto.createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isKnownVerdict(value: unknown): value is JudgeV2Verdict {
  return typeof value === "string" && (JUDGE_V2_VERDICTS as readonly string[]).includes(value);
}

function isKnownRisk(value: unknown): value is JudgeV2Risk {
  return typeof value === "string" && (JUDGE_V2_RISKS as readonly string[]).includes(value);
}

/**
 * Parse the exact JSON contract. Unknown keys, missing fields, code fences,
 * and non-string values fail closed. The legacy six-line parser is kept in
 * judge-gate.ts solely for V1 compatibility and is never the V2 contract.
 */
export function parseJudgeV2ModelOutput(
  text: string,
): { ok: true; value: JudgeV2ModelOutput } | { ok: false; errors: string[] } {
  if (Buffer.byteLength(text, "utf8") > JUDGE_RESPONSE_MAX_BYTES) {
    return { ok: false, errors: [`Judge V2 output exceeds ${JUDGE_RESPONSE_MAX_BYTES} bytes`] };
  }
  const errors: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["Judge V2 output must be one JSON object"] };
  }
  if (!isRecord(parsed)) {
    return { ok: false, errors: ["Judge V2 output must be a JSON object"] };
  }
  const expectedKeys = new Set(["verdict", "scope", "evidence", "risk", "reason", "conditions"]);
  const unknownKeys = Object.keys(parsed).filter((key) => !expectedKeys.has(key));
  if (unknownKeys.length > 0) {
    errors.push(`unknown Judge V2 field(s): ${unknownKeys.toSorted().join(", ")}`);
  }
  const verdict = parsed.verdict;
  const risk = parsed.risk;
  if (!isKnownVerdict(verdict)) {
    errors.push("verdict must be a known Judge V2 verdict");
  }
  if (!isKnownRisk(risk)) {
    errors.push("risk must be a known Judge V2 risk");
  }
  const scope = parsed.scope;
  const evidence = parsed.evidence;
  const reason = parsed.reason;
  const conditions = parsed.conditions;
  for (const field of ["scope", "evidence", "reason", "conditions"] as const) {
    if (!nonEmptyString(parsed[field])) {
      errors.push(`${field} must be a non-empty string`);
    } else if (parsed[field].length > JUDGE_RESPONSE_FIELD_MAX_CHARS) {
      errors.push(`${field} exceeds ${JUDGE_RESPONSE_FIELD_MAX_CHARS} characters`);
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  if (
    !isKnownVerdict(verdict) ||
    !isKnownRisk(risk) ||
    !nonEmptyString(scope) ||
    !nonEmptyString(evidence) ||
    !nonEmptyString(reason) ||
    !nonEmptyString(conditions)
  ) {
    return { ok: false, errors: ["Judge V2 output failed its exact field contract"] };
  }
  return {
    ok: true,
    value: {
      verdict,
      scope,
      evidence,
      risk,
      reason,
      conditions,
    },
  };
}

export function judgeV2ToolPolicyIsEmpty(
  evidence: JudgeModelExecutionEvidence,
  expectedModel?: string,
): boolean {
  return (
    evidence.requestCount === JUDGE_MODEL_REQUEST_COUNT &&
    evidence.modelVisibleTools.length === 0 &&
    (evidence.route === "local" || evidence.route === "hosted") &&
    Boolean(evidence.model.trim()) &&
    (!expectedModel || evidence.model === expectedModel)
  );
}

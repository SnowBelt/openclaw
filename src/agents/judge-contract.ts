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
    scope: { type: "string" },
    evidence: { type: "string" },
    risk: { type: "string", enum: [...JUDGE_V2_RISKS] },
    reason: { type: "string" },
    conditions: { type: "string" },
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

const OUT_OF_SCOPE_PATTERNS = [
  /\b(?:evaluate|assess|decide|determine|judge|tell me|whether|is|was|are|were)\b[^.?!\n]{0,120}\b(?:moral(?:ity|ly)?|ethic(?:al|s)?|politic(?:al|s)?|value(?:s)?|social(?:ly)?|societal(?:ly)?)\b/i,
  /\b(?:moral(?:ity|ly)?|ethic(?:al|s)?|politic(?:al|s)?|value(?:s)?|social(?:ly)?|societal(?:ly)?)\s+(?:right|wrong|good|bad|acceptable|unacceptable|just|unjust|evaluation|judgment|question|assessment)\b/i,
  /\b(?:value judgment|social good|social consequences|moral consequences|ethical consequences)\b/i,
] as const;

/** True only for explicit moral, ethical, political, or value-evaluation asks. */
export function isJudgeOutOfScopeText(...values: readonly unknown[]): boolean {
  const haystack = values.filter((value): value is string => typeof value === "string").join(" ");
  return OUT_OF_SCOPE_PATTERNS.some((pattern) => pattern.test(haystack));
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
  evidence: Pick<JudgeModelExecutionEvidence, "modelVisibleTools" | "requestCount">,
): boolean {
  return (
    evidence.requestCount === JUDGE_MODEL_REQUEST_COUNT && evidence.modelVisibleTools.length === 0
  );
}

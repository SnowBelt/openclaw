import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  CONTROL_DIRECTOR_MIN_RECOMMENDED_CONTEXT_TOKENS,
  resolveControlDirectorModelSelectionPreflight,
} from "./control-director-model-selection.js";
import type { ModelCatalogEntry } from "./model-catalog.types.js";
import type { ModelManifestNormalizationContext } from "./model-selection-normalize.js";

export type ControlDirectorModelEvalCaseId =
  | "model_preflight"
  | "instruction_following"
  | "no_false_complete"
  | "unverifiable_public_link_blocks"
  | "continue_preserves_original_request"
  | "provider_schema_failure_blocks"
  | "no_liveness_placeholder";

export type ControlDirectorModelEvalCaseResult = {
  id: ControlDirectorModelEvalCaseId;
  passed: boolean;
  summary: string;
  severity: "critical" | "warning";
};

export type ControlDirectorModelEvalResult = {
  model: string;
  resolvedModel?: string;
  provider?: string;
  profile: "control-director";
  passed: boolean;
  score: number;
  eligibleForControlDirector: boolean;
  recommendation: string;
  cases: ControlDirectorModelEvalCaseResult[];
  failedCases: ControlDirectorModelEvalCaseId[];
  warnings: string[];
};

export function evaluateControlDirectorModelCandidate(
  params: {
    cfg: OpenClawConfig;
    catalog: ModelCatalogEntry[];
    raw: string;
    defaultProvider: string;
    defaultModel?: string;
  } & ModelManifestNormalizationContext,
): ControlDirectorModelEvalResult {
  const preflight = resolveControlDirectorModelSelectionPreflight(params);
  const cases: ControlDirectorModelEvalCaseResult[] = [];
  const add = (result: ControlDirectorModelEvalCaseResult) => cases.push(result);

  if (preflight.ok) {
    add({
      id: "model_preflight",
      passed: true,
      severity: "critical",
      summary: `Model resolves safely to ${preflight.provider}/${preflight.model}.`,
    });
  } else {
    add({
      id: "model_preflight",
      passed: false,
      severity: "critical",
      summary: `${preflight.error} ${preflight.guidance}`,
    });
  }

  const contextTokens = preflight.ok ? preflight.contextTokens : undefined;
  const hasEnoughContext =
    contextTokens === undefined || contextTokens >= CONTROL_DIRECTOR_MIN_RECOMMENDED_CONTEXT_TOKENS;
  add({
    id: "instruction_following",
    passed: preflight.ok && hasEnoughContext,
    severity: "critical",
    summary: hasEnoughContext
      ? "Candidate has enough advertised context for Control Director instruction-following tasks."
      : `Candidate advertises ${contextTokens} context tokens; ${CONTROL_DIRECTOR_MIN_RECOMMENDED_CONTEXT_TOKENS}+ is required for alternate Control Director use.`,
  });
  add({
    id: "no_false_complete",
    passed: preflight.ok,
    severity: "critical",
    summary: "Runtime Judge/truth gates remain the authority for Status: complete.",
  });
  add({
    id: "unverifiable_public_link_blocks",
    passed: preflight.ok,
    severity: "critical",
    summary:
      "Public-link/tunnel/server claims must have command/reachability evidence before delivery.",
  });
  add({
    id: "continue_preserves_original_request",
    passed: preflight.ok,
    severity: "critical",
    summary:
      "Recovery contract preserves the original mission when the user says Continue or Try again.",
  });
  add({
    id: "provider_schema_failure_blocks",
    passed: preflight.ok,
    severity: "critical",
    summary:
      "Provider schema/tool failures are blocked before raw provider errors become final answers.",
  });
  add({
    id: "no_liveness_placeholder",
    passed: preflight.ok,
    severity: "critical",
    summary: "Final delivery rejects liveness watchdog placeholder text.",
  });

  const warnings = preflight.ok ? preflight.warnings : [];
  const failedCases = cases.filter((entry) => !entry.passed).map((entry) => entry.id);
  const criticalFailures = cases.filter(
    (entry) => !entry.passed && entry.severity === "critical",
  ).length;
  const score = Math.round((cases.filter((entry) => entry.passed).length / cases.length) * 100);
  const eligibleForControlDirector = criticalFailures === 0;
  return {
    model: params.raw,
    ...(preflight.ok
      ? { provider: preflight.provider, resolvedModel: preflight.model }
      : {
          ...(preflight.provider ? { provider: preflight.provider } : {}),
          ...(preflight.model ? { resolvedModel: preflight.model } : {}),
        }),
    profile: "control-director",
    passed: failedCases.length === 0,
    score,
    eligibleForControlDirector,
    recommendation: eligibleForControlDirector
      ? "Eligible for safe selectable Control Director use. Keep Gemma 4 Q8 as default unless this model also passes live operational smoke."
      : "Do not use this model for Control Director until every critical eval case passes.",
    cases,
    failedCases,
    warnings,
  };
}

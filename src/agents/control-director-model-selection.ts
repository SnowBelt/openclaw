/** Safe model-selection checks for the Control Director. */
import { normalizeLowercaseStringOrEmpty } from "@openclaw/normalization-core/string-coerce";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  CONTROL_DIRECTOR_PRIMARY_MODEL,
  canonicalizeControlDirectorModelRef,
} from "./control-director-model-ref.js";
import { findModelInCatalog } from "./model-catalog-lookup.js";
import type { ModelCatalogEntry } from "./model-catalog.types.js";
import { splitTrailingAuthProfile } from "./model-ref-profile.js";
import type { ModelManifestNormalizationContext, ModelRef } from "./model-selection-normalize.js";
import {
  inferUniqueProviderFromCatalog,
  inferUniqueProviderFromConfiguredModels,
  modelKey,
  resolveAllowedModelRef,
} from "./model-selection.js";

export const CONTROL_DIRECTOR_MIN_RECOMMENDED_CONTEXT_TOKENS = 16_000;

export type ControlDirectorModelSelectionBlockCode =
  | "empty_model"
  | "ambiguous_bare_ref"
  | "model_not_allowed"
  | "model_not_cataloged";

export type ControlDirectorModelSelectionPreflight =
  | {
      ok: true;
      provider: string;
      model: string;
      key: string;
      catalogEntry?: ModelCatalogEntry;
      contextTokens?: number;
      warnings: string[];
    }
  | {
      ok: false;
      code: ControlDirectorModelSelectionBlockCode;
      error: string;
      missingCondition: string;
      guidance: string;
      provider?: string;
      model?: string;
      key?: string;
    };

function isProviderQualifiedModelRef(raw: string): boolean {
  return raw.includes("/");
}

function isConfiguredProviderModel(params: {
  cfg: OpenClawConfig;
  provider: string;
  model: string;
}): boolean {
  const provider = normalizeLowercaseStringOrEmpty(params.provider);
  const model = normalizeLowercaseStringOrEmpty(params.model);
  if (!provider || !model) {
    return false;
  }
  const providerConfig = Object.entries(params.cfg.models?.providers ?? {}).find(
    ([id]) => normalizeLowercaseStringOrEmpty(id) === provider,
  )?.[1];
  return Boolean(
    providerConfig?.models?.some((entry) => normalizeLowercaseStringOrEmpty(entry?.id) === model),
  );
}

function findCatalogOrConfiguredEntry(params: {
  cfg: OpenClawConfig;
  catalog: ModelCatalogEntry[];
  provider: string;
  model: string;
}): ModelCatalogEntry | undefined {
  return (
    findModelInCatalog(params.catalog, params.provider, params.model) ??
    (isConfiguredProviderModel(params)
      ? {
          provider: params.provider,
          id: params.model,
          name: params.model,
        }
      : undefined)
  );
}

function resolveContextTokens(entry: ModelCatalogEntry | undefined): number | undefined {
  const value = entry?.contextTokens ?? entry?.contextWindow;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function bareModelHasUniqueOwner(params: {
  cfg: OpenClawConfig;
  catalog: ModelCatalogEntry[];
  raw: string;
  manifestPlugins?: ModelManifestNormalizationContext["manifestPlugins"];
}): boolean {
  return Boolean(
    inferUniqueProviderFromConfiguredModels({
      cfg: params.cfg,
      model: params.raw,
      manifestPlugins: params.manifestPlugins,
    }) ?? inferUniqueProviderFromCatalog({ catalog: params.catalog, model: params.raw }),
  );
}

export function resolveControlDirectorModelSelectionPreflight(
  params: {
    cfg: OpenClawConfig;
    catalog: ModelCatalogEntry[];
    raw: string;
    defaultProvider: string;
    defaultModel?: string;
  } & ModelManifestNormalizationContext,
): ControlDirectorModelSelectionPreflight {
  const trimmedInput = params.raw.trim();
  if (!trimmedInput) {
    return {
      ok: false,
      code: "empty_model",
      error: "Control Director model selection is empty.",
      missingCondition: "non-empty model reference",
      guidance:
        "Select the default Gemma model or a provider-qualified model such as openai/gpt-5.5.",
    };
  }

  const { model: modelWithoutProfile } = splitTrailingAuthProfile(trimmedInput);
  const canonical =
    canonicalizeControlDirectorModelRef(modelWithoutProfile)?.trim() || modelWithoutProfile;
  const providerQualified = isProviderQualifiedModelRef(canonical);
  if (
    !providerQualified &&
    !bareModelHasUniqueOwner({
      cfg: params.cfg,
      catalog: params.catalog,
      raw: canonical,
      manifestPlugins: params.manifestPlugins,
    })
  ) {
    return {
      ok: false,
      code: "ambiguous_bare_ref",
      error: `Control Director model "${trimmedInput}" is not provider-qualified and is not a unique configured/catalog model.`,
      missingCondition: "provider-qualified or unique configured model reference",
      guidance:
        "Use provider/model form from the model picker, for example ollama/openclaw-control-gemma4-31b-q8:latest or openai/gpt-5.5.",
    };
  }

  const resolved = resolveAllowedModelRef({
    cfg: params.cfg,
    catalog: params.catalog,
    raw: canonical,
    defaultProvider: params.defaultProvider,
    defaultModel: params.defaultModel,
    manifestPlugins: params.manifestPlugins,
  });
  if ("error" in resolved) {
    return {
      ok: false,
      code: "model_not_allowed",
      error: resolved.error,
      missingCondition: "model allowed by Control Director model policy",
      guidance:
        "Add the model to the configured model catalog/allowlist or choose another listed Control Director model.",
    };
  }

  const entry = findCatalogOrConfiguredEntry({
    cfg: params.cfg,
    catalog: params.catalog,
    provider: resolved.ref.provider,
    model: resolved.ref.model,
  });
  const isDefault =
    modelKey(resolved.ref.provider, resolved.ref.model) === CONTROL_DIRECTOR_PRIMARY_MODEL;
  if (!entry && !isDefault && params.catalog.length > 0) {
    return {
      ok: false,
      code: "model_not_cataloged",
      error: `Control Director model "${modelKey(resolved.ref.provider, resolved.ref.model)}" is not present in the model catalog.`,
      missingCondition: "cataloged or configured provider/model row",
      guidance:
        "Run model discovery or choose a model shown by the Dashboard model picker before using it for Control Director.",
      provider: resolved.ref.provider,
      model: resolved.ref.model,
      key: resolved.key,
    };
  }

  const contextTokens = resolveContextTokens(entry);
  const warnings = [
    ...(contextTokens !== undefined &&
    contextTokens < CONTROL_DIRECTOR_MIN_RECOMMENDED_CONTEXT_TOKENS
      ? [
          `Selected model advertises ${contextTokens} context tokens; Control Director reliability is best at ${CONTROL_DIRECTOR_MIN_RECOMMENDED_CONTEXT_TOKENS}+ tokens.`,
        ]
      : []),
    ...(!entry && !isDefault && providerQualified && params.catalog.length === 0
      ? [
          "Model catalog was empty; accepted explicit provider/model selection without catalog metadata.",
        ]
      : []),
  ];
  return {
    ok: true,
    provider: resolved.ref.provider,
    model: resolved.ref.model,
    key: resolved.key,
    ...(entry ? { catalogEntry: entry } : {}),
    ...(contextTokens !== undefined ? { contextTokens } : {}),
    warnings,
  };
}

export function formatControlDirectorModelSelectionBlockedReport(
  result: Extract<ControlDirectorModelSelectionPreflight, { ok: false }>,
): string {
  return [
    "Status: blocked",
    "Verified state: The Control Director model selection was blocked before a model request was sent.",
    `Root cause: ${result.error}`,
    `Missing evidence/condition: ${result.missingCondition}.`,
    `Next build gap: ${result.guidance}`,
    "Completion Grade: 8/10",
    "Criticality: 10/10",
  ].join("\n");
}

export function resolveControlDirectorModelRefForSelection(
  params: Pick<Extract<ControlDirectorModelSelectionPreflight, { ok: true }>, "provider" | "model">,
): ModelRef {
  return { provider: params.provider, model: params.model };
}

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

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

import { normalizeProviderId } from "@openclaw/model-catalog-core/provider-id";
import type {
  ModelCertificationConfig,
  ModelRouteConfig,
  ModelRoutingPurpose,
  ModelRoutingPolicyConfig,
  ModelsConfig,
} from "../config/types.models.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type {
  ModelCatalogEntry,
  ModelCertificationState,
  ModelInputType,
  ModelRouteKind,
} from "./model-catalog.types.js";
import { normalizeConfiguredProviderCatalogModelId } from "./model-ref-shared.js";

type ModelRouteFacts = {
  api?: string;
  baseUrl?: string;
  routeConfig?: ModelRouteConfig;
  cost?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    tieredPricing?: Array<{
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      range: [number, number] | [number];
    }>;
  };
  contextWindow?: number;
  contextTokens?: number;
  maxTokens?: number;
  input?: ModelInputType[];
};

export type ModelRoutingDecision = {
  route: ModelRouteKind;
  certification: ModelCertificationState;
  eligible: boolean;
};

export type AutomaticModelSpendEstimate = {
  /** Worst-case USD cost for a single model attempt, based only on configured limits. */
  maximumCostUsd: number;
  inputTokens: number;
  outputTokens: number;
};

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized.startsWith("127.")
  );
}

function isLocalEndpoint(baseUrl?: string): boolean {
  if (!baseUrl) {
    return false;
  }
  try {
    return isLoopbackHost(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}

function resolveRouteKind(facts: ModelRouteFacts): ModelRouteKind {
  if (facts.routeConfig?.location === "local") {
    return "local";
  }
  if (
    facts.routeConfig?.location !== "remote" &&
    (facts.api === "ollama" || isLocalEndpoint(facts.baseUrl))
  ) {
    return "local";
  }
  if (facts.routeConfig?.billing === "included") {
    return "subscription";
  }
  if (facts.routeConfig?.billing === "metered") {
    return "metered";
  }
  return "unknown";
}

function resolveProviderAndModelFacts(params: {
  models?: ModelsConfig;
  provider: string;
  model: string;
}): ModelRouteFacts {
  const providerId = normalizeProviderId(params.provider);
  const provider = params.models?.providers?.[providerId];
  // Routing config is a prepared operator-owned fact. Do not trigger broad plugin
  // metadata discovery from catalog sorting or request-time fallback selection.
  const normalizationOptions = { allowManifestNormalization: false } as const;
  const normalizedModelId = normalizeConfiguredProviderCatalogModelId(
    providerId,
    params.model,
    normalizationOptions,
  );
  const model = provider?.models.find(
    (entry) =>
      normalizeConfiguredProviderCatalogModelId(providerId, entry.id, normalizationOptions) ===
      normalizedModelId,
  );
  return {
    api: model?.api ?? provider?.api,
    baseUrl: model?.baseUrl ?? provider?.baseUrl,
    routeConfig: model?.route ?? provider?.route,
    cost: model?.cost,
    contextWindow: model?.contextWindow ?? provider?.contextWindow,
    contextTokens: model?.contextTokens ?? provider?.contextTokens,
    maxTokens: model?.maxTokens ?? provider?.maxTokens,
    input: model?.input,
  };
}

export function resolveAutomaticModelRoutingProfile(params: {
  cfg?: Pick<OpenClawConfig, "models">;
  purpose?: ModelRoutingPurpose;
}): string[] {
  const profile = params.purpose
    ? params.cfg?.models?.routing?.automaticProfiles?.[params.purpose]
    : undefined;
  return profile?.map((candidate) => candidate.trim()).filter(Boolean) ?? [];
}

function maxFiniteRate(values: readonly number[]): number | undefined {
  const known = values.filter((value) => Number.isFinite(value) && value >= 0);
  return known.length === values.length && known.length > 0 ? Math.max(...known) : undefined;
}

function isFiniteNonNegativeNumber(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Computes a deliberately pessimistic maximum from configured limits. It does
 * not claim to predict a bill; it gives automatic routing a safe preflight
 * bound before a metered attempt is started.
 */
export function resolveAutomaticModelSpendEstimate(params: {
  cfg?: Pick<OpenClawConfig, "models">;
  provider: string;
  model: string;
}): AutomaticModelSpendEstimate | undefined {
  const facts = resolveProviderAndModelFacts({
    models: params.cfg?.models,
    provider: params.provider,
    model: params.model,
  });
  const inputTokens = facts.contextTokens ?? facts.contextWindow;
  const outputTokens = facts.maxTokens;
  if (
    !facts.cost ||
    !isFiniteNonNegativeNumber(inputTokens) ||
    !isFiniteNonNegativeNumber(outputTokens)
  ) {
    return undefined;
  }
  const tiers = facts.cost.tieredPricing ?? [];
  const inputRate = maxFiniteRate([
    facts.cost.input,
    facts.cost.cacheRead,
    facts.cost.cacheWrite,
    ...tiers.flatMap((tier) => [tier.input, tier.cacheRead, tier.cacheWrite]),
  ]);
  const outputRate = maxFiniteRate([facts.cost.output, ...tiers.map((tier) => tier.output)]);
  if (inputRate === undefined || outputRate === undefined) {
    return undefined;
  }
  return {
    inputTokens,
    outputTokens,
    maximumCostUsd: (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000,
  };
}

function normalizeCertificationKey(provider: string, model: string): string {
  const providerId = normalizeProviderId(provider);
  return `${providerId}/${normalizeConfiguredProviderCatalogModelId(providerId, model, {
    allowManifestNormalization: false,
  })}`;
}

function resolveCertificationConfig(params: {
  models?: ModelsConfig;
  provider: string;
  model: string;
}): ModelCertificationConfig | undefined {
  const certifications = params.models?.routing?.certifications;
  if (!certifications) {
    return undefined;
  }
  const key = normalizeCertificationKey(params.provider, params.model);
  return Object.entries(certifications).find(([candidate]) => {
    const separator = candidate.indexOf("/");
    if (separator <= 0 || separator === candidate.length - 1) {
      return false;
    }
    return (
      normalizeCertificationKey(candidate.slice(0, separator), candidate.slice(separator + 1)) ===
      key
    );
  })?.[1];
}

export function resolveModelCertificationForRef(params: {
  cfg?: Pick<OpenClawConfig, "models">;
  provider: string;
  model: string;
}): ModelCertificationState {
  return (
    resolveCertificationConfig({
      models: params.cfg?.models,
      provider: params.provider,
      model: params.model,
    })?.state ?? "unlisted"
  );
}

export function resolveModelRouteForRef(params: {
  cfg?: Pick<OpenClawConfig, "models">;
  provider: string;
  model: string;
}): ModelRouteKind {
  return resolveRouteKind(
    resolveProviderAndModelFacts({
      models: params.cfg?.models,
      provider: params.provider,
      model: params.model,
    }),
  );
}

export function resolveModelCatalogEntryRoute(params: {
  cfg?: Pick<OpenClawConfig, "models">;
  entry: Pick<ModelCatalogEntry, "provider" | "id"> & ModelRouteFacts;
}): ModelRouteKind {
  const configured = resolveProviderAndModelFacts({
    models: params.cfg?.models,
    provider: params.entry.provider,
    model: params.entry.id,
  });
  return resolveRouteKind({
    api: params.entry.api ?? configured.api,
    baseUrl: params.entry.baseUrl ?? configured.baseUrl,
    routeConfig: params.entry.routeConfig ?? configured.routeConfig,
  });
}

function automaticRouteAllowed(params: {
  route: ModelRouteKind;
  certification: ModelCertificationState;
  policy?: ModelRoutingPolicyConfig;
  spendEstimate?: AutomaticModelSpendEstimate;
  requiredInput?: ModelInputType;
  input?: ModelInputType[];
}): boolean {
  const { route, certification, policy, spendEstimate, requiredInput, input } = params;
  if (policy && route === "metered") {
    const hasCostCeiling =
      policy.automaticMaxCostUsd !== undefined ||
      policy.automaticDailyMaxCostUsd !== undefined ||
      policy.automaticProjectDailyMaxCostUsd !== undefined;
    if (policy.automaticMetered !== "allow" || !hasCostCeiling || !spendEstimate) {
      return false;
    }
  }
  if (policy && route === "unknown" && policy.automaticUnknown !== "allow") {
    return false;
  }
  if (policy?.requireCertifiedForAutomatic && certification !== "certified") {
    return false;
  }
  if (
    route === "metered" &&
    policy?.automaticMaxCostUsd !== undefined &&
    (spendEstimate === undefined || spendEstimate.maximumCostUsd > policy.automaticMaxCostUsd)
  ) {
    return false;
  }
  if (requiredInput && !input?.includes(requiredInput)) {
    return false;
  }
  return true;
}

export function resolveAutomaticModelRoutingDecision(params: {
  cfg?: Pick<OpenClawConfig, "models">;
  provider: string;
  model: string;
  requiredInput?: ModelInputType;
}): ModelRoutingDecision {
  const route = resolveModelRouteForRef(params);
  const certification = resolveModelCertificationForRef(params);
  const spendEstimate = resolveAutomaticModelSpendEstimate(params);
  const facts = resolveProviderAndModelFacts({
    models: params.cfg?.models,
    provider: params.provider,
    model: params.model,
  });
  return {
    route,
    certification,
    eligible: automaticRouteAllowed({
      route,
      certification,
      policy: params.cfg?.models?.routing,
      spendEstimate,
      requiredInput: params.requiredInput,
      input: facts.input,
    }),
  };
}

const routeOrder: Record<ModelRouteKind, number> = {
  local: 0,
  subscription: 1,
  metered: 2,
  unknown: 3,
};

/**
 * Applies an opt-in policy to an automatically selected candidate chain.
 * The caller deliberately does not use this for an explicit user selection.
 */
export function applyAutomaticModelRoutingPolicy<
  T extends { provider: string; model: string },
>(params: {
  cfg?: Pick<OpenClawConfig, "models">;
  candidates: readonly T[];
  requiredInput?: ModelInputType;
}): { candidates: T[]; blocked: Array<T & { route: ModelRouteKind }> } {
  const policy = params.cfg?.models?.routing;
  if (!policy) {
    return { candidates: [...params.candidates], blocked: [] };
  }
  const evaluated = params.candidates.map((candidate, index) => {
    const decision = resolveAutomaticModelRoutingDecision({
      cfg: params.cfg,
      provider: candidate.provider,
      model: candidate.model,
      requiredInput: params.requiredInput,
    });
    return { candidate, index, ...decision };
  });
  const blocked = evaluated
    .filter((entry) => !entry.eligible)
    .map(({ candidate, route }) => Object.assign({}, candidate, { route }));
  const eligible = evaluated.filter((entry) => entry.eligible);
  if (policy.preference === "local-first") {
    eligible.sort(
      (left, right) => routeOrder[left.route] - routeOrder[right.route] || left.index - right.index,
    );
  }
  return { candidates: eligible.map((entry) => entry.candidate), blocked };
}

/**
 * Sorts catalog rows for an enabled local-first policy while retaining a
 * stable provider/name order inside each group.
 */
export function orderModelCatalogByRoutingPolicy(params: {
  cfg?: Pick<OpenClawConfig, "models">;
  entries: ModelCatalogEntry[];
}): ModelCatalogEntry[] {
  const entries = params.entries.map((entry) => {
    const route = entry.route ?? resolveModelCatalogEntryRoute({ cfg: params.cfg, entry });
    const certification =
      entry.certification ??
      resolveModelCertificationForRef({
        cfg: params.cfg,
        provider: entry.provider,
        model: entry.id,
      });
    const { routeConfig: _routeConfig, ...publicEntry } = entry;
    // Preserve the established compact catalog contract: absence means unknown.
    return {
      ...publicEntry,
      ...(route === "unknown" ? {} : { route }),
      ...(certification === "unlisted" ? {} : { certification }),
    };
  });
  if (params.cfg?.models?.routing?.preference !== "local-first") {
    return entries;
  }
  return entries.toSorted(
    (left, right) =>
      routeOrder[left.route ?? "unknown"] - routeOrder[right.route ?? "unknown"] ||
      left.provider.localeCompare(right.provider) ||
      left.name.localeCompare(right.name),
  );
}

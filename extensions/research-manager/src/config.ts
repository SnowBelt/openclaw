import type { ResearchMode, ResearchModelSpec } from "./types.js";

export type ResearchManagerConfig = {
  defaultMode?: ResearchMode;
  certificationThreshold?: number;
  models?: ResearchModelSpec[];
  resourceLimits?: Partial<ResolvedResearchManagerConfig["resourceLimits"]>;
  retrieval?: Partial<ResolvedResearchManagerConfig["retrieval"]>;
  certification?: Partial<ResolvedResearchManagerConfig["certification"]>;
  modelTimeoutMs?: number;
  maxModelAttempts?: number;
  stateTtlDays?: number;
};

export type ResolvedResearchManagerConfig = {
  defaultMode: ResearchMode;
  certificationThreshold: number;
  models: ResearchModelSpec[];
  resourceLimits: {
    softMemoryGb: number;
    hardMemoryGb: number;
    absoluteMemoryGb: number;
    maxLocalParallel: number;
    maxLoadedModels: number;
    maxLogicalWorkers: number;
    queueLimit: number;
    queueDeadlineMs: number;
  };
  retrieval: {
    providerOrder: string[];
    searchConcurrency: number;
    fallbackDelayMs: number;
    queryCount: number;
    resultsPerQuery: number;
    maxSources: number;
    fetchConcurrency: number;
    fetchTimeoutMs: number;
    maxBytesPerSource: number;
    maxCharsPerSource: number;
    requireHttps: boolean;
  };
  certification: {
    minSources: number;
    minDomains: number;
    maxRepairPasses: number;
    requireFrontierPlan: boolean;
    requireFrontierFinalizer: boolean;
    requireVerifiedCitations: boolean;
  };
  modelTimeoutMs: number;
  maxModelAttempts: number;
  stateTtlDays: number;
};

export const DEFAULT_RESEARCH_MODELS: ResearchModelSpec[] = [
  {
    id: "sol-planner-finalizer",
    provider: "codex",
    model: "gpt-5.6-sol",
    authProfileId: "openai-codex:default",
    roles: ["planner", "finalizer"],
    remote: true,
    memoryGb: 0,
    contextTokens: 1_000_000,
    maxParallel: 2,
    thinking: "high",
    qualificationScore: 0,
    enabled: true,
    exclusive: false,
  },
  {
    id: "sol-general-fallback",
    provider: "codex",
    model: "gpt-5.6-sol",
    authProfileId: "openai-codex:default",
    roles: ["scout", "researcher", "verifier", "critic"],
    remote: true,
    memoryGb: 0,
    contextTokens: 1_000_000,
    maxParallel: 2,
    thinking: "high",
    qualificationScore: 0,
    enabled: true,
    exclusive: false,
  },
  {
    id: "gpt-5.5-fallback",
    provider: "codex",
    model: "gpt-5.5",
    authProfileId: "openai-codex:default",
    roles: ["planner", "scout", "researcher", "verifier", "critic", "finalizer"],
    remote: true,
    memoryGb: 0,
    contextTokens: 272_000,
    maxParallel: 1,
    thinking: "high",
    qualificationScore: 0,
    enabled: true,
    exclusive: false,
  },
  {
    id: "qwen3.6-27b-researcher",
    provider: "ollama",
    model: "qwen3.6:27b-q8_0",
    roles: ["planner", "researcher", "critic", "finalizer"],
    remote: false,
    memoryGb: 31,
    contextTokens: 65_536,
    maxParallel: 1,
    thinking: "off",
    qualificationScore: 0,
    enabled: true,
    exclusive: false,
  },
  {
    id: "gemma4-31b-verifier",
    provider: "ollama",
    model: "openclaw-control-gemma4-31b-q8:latest",
    roles: ["verifier", "critic"],
    remote: false,
    memoryGb: 35,
    contextTokens: 65_536,
    maxParallel: 1,
    thinking: "off",
    qualificationScore: 0,
    enabled: true,
    exclusive: false,
  },
  {
    id: "qwen3.5-9b-scout",
    provider: "ollama",
    model: "qwen3.5:9b-q4_K_M",
    roles: ["scout", "researcher"],
    remote: false,
    memoryGb: 8,
    contextTokens: 24_576,
    maxParallel: 1,
    thinking: "off",
    qualificationScore: 0,
    enabled: true,
    exclusive: false,
  },
];

export const DEFAULT_RESEARCH_MANAGER_CONFIG: ResolvedResearchManagerConfig = {
  defaultMode: "certified",
  certificationThreshold: 93,
  models: DEFAULT_RESEARCH_MODELS,
  resourceLimits: {
    softMemoryGb: 130,
    hardMemoryGb: 145,
    absoluteMemoryGb: 150,
    maxLocalParallel: 1,
    maxLoadedModels: 3,
    maxLogicalWorkers: 5,
    queueLimit: 32,
    queueDeadlineMs: 15 * 60 * 1000,
  },
  retrieval: {
    providerOrder: [],
    searchConcurrency: 3,
    fallbackDelayMs: 2_000,
    queryCount: 24,
    resultsPerQuery: 8,
    maxSources: 36,
    fetchConcurrency: 4,
    fetchTimeoutMs: 20_000,
    maxBytesPerSource: 1_500_000,
    maxCharsPerSource: 50_000,
    requireHttps: true,
  },
  certification: {
    minSources: 8,
    minDomains: 4,
    maxRepairPasses: 2,
    requireFrontierPlan: true,
    requireFrontierFinalizer: true,
    requireVerifiedCitations: true,
  },
  modelTimeoutMs: 15 * 60 * 1000,
  maxModelAttempts: 3,
  stateTtlDays: 30,
};

function finitePositive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function boundedScore(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : fallback;
}

function finiteNonNegative(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function normalizeProviderOrder(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_RESEARCH_MANAGER_CONFIG.retrieval.providerOrder];
  }
  return [
    ...new Set(
      value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].slice(0, 8);
}

function normalizeModels(models: ResearchModelSpec[] | undefined): ResearchModelSpec[] {
  const cloneModel = (model: ResearchModelSpec): ResearchModelSpec => {
    const normalized: ResearchModelSpec = {
      id: model.id.trim(),
      provider: model.provider.trim(),
      model: model.model.trim(),
      roles: [...new Set(model.roles)],
      remote: model.remote,
      memoryGb: Math.max(0, model.memoryGb),
      contextTokens: Math.max(1024, Math.floor(model.contextTokens)),
      maxParallel: Math.max(1, Math.floor(model.maxParallel)),
      qualificationScore: boundedScore(model.qualificationScore, 0),
      enabled: model.enabled,
      exclusive: model.exclusive,
    };
    const authProfileId = model.authProfileId?.trim();
    if (authProfileId) {
      normalized.authProfileId = authProfileId;
    }
    if (model.thinking) {
      normalized.thinking = model.thinking;
    }
    return normalized;
  };
  if (!Array.isArray(models) || models.length === 0) {
    return DEFAULT_RESEARCH_MODELS.map(cloneModel);
  }
  return models.map(cloneModel);
}

export function resolveResearchManagerConfig(
  input?: ResearchManagerConfig | Record<string, unknown>,
): ResolvedResearchManagerConfig {
  const config = (input ?? {}) as ResearchManagerConfig;
  const resources = config.resourceLimits ?? {};
  const retrieval = config.retrieval ?? {};
  const certification = config.certification ?? {};
  const absoluteMemoryGb = finitePositive(
    resources.absoluteMemoryGb,
    DEFAULT_RESEARCH_MANAGER_CONFIG.resourceLimits.absoluteMemoryGb,
  );
  const hardMemoryGb = Math.min(
    absoluteMemoryGb,
    finitePositive(
      resources.hardMemoryGb,
      DEFAULT_RESEARCH_MANAGER_CONFIG.resourceLimits.hardMemoryGb,
    ),
  );
  const softMemoryGb = Math.min(
    hardMemoryGb,
    finitePositive(
      resources.softMemoryGb,
      DEFAULT_RESEARCH_MANAGER_CONFIG.resourceLimits.softMemoryGb,
    ),
  );

  return {
    defaultMode: config.defaultMode === "best-effort" ? "best-effort" : "certified",
    certificationThreshold: boundedScore(
      config.certificationThreshold,
      DEFAULT_RESEARCH_MANAGER_CONFIG.certificationThreshold,
    ),
    models: normalizeModels(config.models),
    resourceLimits: {
      softMemoryGb,
      hardMemoryGb,
      absoluteMemoryGb,
      maxLocalParallel: Math.min(
        8,
        Math.floor(
          finitePositive(
            resources.maxLocalParallel,
            DEFAULT_RESEARCH_MANAGER_CONFIG.resourceLimits.maxLocalParallel,
          ),
        ),
      ),
      maxLoadedModels: Math.min(
        8,
        Math.floor(
          finitePositive(
            resources.maxLoadedModels,
            DEFAULT_RESEARCH_MANAGER_CONFIG.resourceLimits.maxLoadedModels,
          ),
        ),
      ),
      maxLogicalWorkers: Math.max(
        3,
        Math.min(
          5,
          Math.floor(
            finitePositive(
              resources.maxLogicalWorkers,
              DEFAULT_RESEARCH_MANAGER_CONFIG.resourceLimits.maxLogicalWorkers,
            ),
          ),
        ),
      ),
      queueLimit: Math.min(
        128,
        Math.floor(
          finitePositive(
            resources.queueLimit,
            DEFAULT_RESEARCH_MANAGER_CONFIG.resourceLimits.queueLimit,
          ),
        ),
      ),
      queueDeadlineMs: finitePositive(
        resources.queueDeadlineMs,
        DEFAULT_RESEARCH_MANAGER_CONFIG.resourceLimits.queueDeadlineMs,
      ),
    },
    retrieval: {
      providerOrder: normalizeProviderOrder(retrieval.providerOrder),
      searchConcurrency: Math.min(
        8,
        Math.floor(
          finitePositive(
            retrieval.searchConcurrency,
            DEFAULT_RESEARCH_MANAGER_CONFIG.retrieval.searchConcurrency,
          ),
        ),
      ),
      fallbackDelayMs: Math.min(
        30_000,
        finiteNonNegative(
          retrieval.fallbackDelayMs,
          DEFAULT_RESEARCH_MANAGER_CONFIG.retrieval.fallbackDelayMs,
        ),
      ),
      queryCount: Math.min(
        24,
        Math.floor(
          finitePositive(
            retrieval.queryCount,
            DEFAULT_RESEARCH_MANAGER_CONFIG.retrieval.queryCount,
          ),
        ),
      ),
      resultsPerQuery: Math.min(
        20,
        Math.floor(
          finitePositive(
            retrieval.resultsPerQuery,
            DEFAULT_RESEARCH_MANAGER_CONFIG.retrieval.resultsPerQuery,
          ),
        ),
      ),
      maxSources: Math.min(
        100,
        Math.floor(
          finitePositive(
            retrieval.maxSources,
            DEFAULT_RESEARCH_MANAGER_CONFIG.retrieval.maxSources,
          ),
        ),
      ),
      fetchConcurrency: Math.min(
        12,
        Math.floor(
          finitePositive(
            retrieval.fetchConcurrency,
            DEFAULT_RESEARCH_MANAGER_CONFIG.retrieval.fetchConcurrency,
          ),
        ),
      ),
      fetchTimeoutMs: finitePositive(
        retrieval.fetchTimeoutMs,
        DEFAULT_RESEARCH_MANAGER_CONFIG.retrieval.fetchTimeoutMs,
      ),
      maxBytesPerSource: finitePositive(
        retrieval.maxBytesPerSource,
        DEFAULT_RESEARCH_MANAGER_CONFIG.retrieval.maxBytesPerSource,
      ),
      maxCharsPerSource: finitePositive(
        retrieval.maxCharsPerSource,
        DEFAULT_RESEARCH_MANAGER_CONFIG.retrieval.maxCharsPerSource,
      ),
      requireHttps: retrieval.requireHttps !== false,
    },
    certification: {
      minSources: Math.floor(
        finitePositive(
          certification.minSources,
          DEFAULT_RESEARCH_MANAGER_CONFIG.certification.minSources,
        ),
      ),
      minDomains: Math.floor(
        finitePositive(
          certification.minDomains,
          DEFAULT_RESEARCH_MANAGER_CONFIG.certification.minDomains,
        ),
      ),
      maxRepairPasses: Math.max(
        0,
        Math.min(
          5,
          Math.floor(
            typeof certification.maxRepairPasses === "number"
              ? certification.maxRepairPasses
              : DEFAULT_RESEARCH_MANAGER_CONFIG.certification.maxRepairPasses,
          ),
        ),
      ),
      requireFrontierPlan: certification.requireFrontierPlan !== false,
      requireFrontierFinalizer: certification.requireFrontierFinalizer !== false,
      requireVerifiedCitations: certification.requireVerifiedCitations !== false,
    },
    modelTimeoutMs: finitePositive(
      config.modelTimeoutMs,
      DEFAULT_RESEARCH_MANAGER_CONFIG.modelTimeoutMs,
    ),
    maxModelAttempts: Math.max(
      1,
      Math.min(
        8,
        Math.floor(
          finitePositive(config.maxModelAttempts, DEFAULT_RESEARCH_MANAGER_CONFIG.maxModelAttempts),
        ),
      ),
    ),
    stateTtlDays: Math.max(
      1,
      Math.min(
        365,
        Math.floor(
          finitePositive(config.stateTtlDays, DEFAULT_RESEARCH_MANAGER_CONFIG.stateTtlDays),
        ),
      ),
    ),
  };
}

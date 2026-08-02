import { randomUUID } from "node:crypto";
import type { OpenClawPluginApi, OpenClawPluginToolContext } from "../api.js";
import {
  createSolOnlyConfig,
  runAcceptanceBenchmark,
  type AcceptanceBenchmarkReceipt,
} from "./acceptance.js";
import { resolveResearchManagerConfig, type ResolvedResearchManagerConfig } from "./config.js";
import {
  loadEvaluationCorpus,
  runModelBakeoff,
  type EvaluationCorpus,
  type ModelBakeoffReceipt,
} from "./evaluation.js";
import { ModelCapabilityRegistry } from "./model-registry.js";
import { StructuredModelRunner, type ModelProbeResult } from "./model-runner.js";
import { readOllamaInventory, type OllamaInventory } from "./ollama.js";
import { runResearchPipeline } from "./pipeline.js";
import { createResearchReplaySeed } from "./replay.js";
import { ResourceScheduler } from "./resource-scheduler.js";
import { collectSearchCandidates } from "./retrieval.js";
import { ResearchRunStore, type ModelQualificationRecord } from "./store.js";
import type {
  ResearchModelRole,
  ResearchModelSpec,
  ResearchRunReport,
  ResearchRunRequest,
} from "./types.js";

export const RESEARCH_MODEL_ROLES = new Set<ResearchModelRole>([
  "planner",
  "scout",
  "researcher",
  "verifier",
  "critic",
  "finalizer",
]);

export function qualificationMatchesCorpus(
  record: ModelQualificationRecord,
  corpus: Pick<EvaluationCorpus, "version" | "sha256">,
): boolean {
  return record.corpusVersion === corpus.version && record.corpusSha256 === corpus.sha256;
}

export function modelProbeIdentity(model: ResearchModelSpec): string {
  return JSON.stringify([
    model.provider,
    model.model,
    model.authProfileId ?? null,
    model.thinking ?? null,
  ]);
}

export type DoctorModelStatus = ReturnType<ModelCapabilityRegistry["snapshot"]>[number] & {
  busy: boolean;
};

export type DoctorWebSearchProbe = {
  ok: boolean;
  provider?: string;
  resultCount: number;
  durationMs: number;
  error?: string;
};

export function assessDoctorReadiness(params: {
  models: DoctorModelStatus[];
  probes: ModelProbeResult[];
  webSearchProviders: string[];
  webSearchProbe?: DoctorWebSearchProbe;
  certifiedRoles: ReadonlySet<ResearchModelRole>;
}): { issues: string[]; warnings: string[] } {
  const issues: string[] = [];
  const warnings: string[] = [];
  for (const status of params.models) {
    const prefix = `${status.model.id}:${status.role}`;
    if (!status.model.enabled) {
      continue;
    }
    if (status.reachable === false || status.installed === false || !status.compatible) {
      issues.push(...status.reasons.map((reason) => `${prefix}: ${reason}`));
    } else if (!status.qualified) {
      warnings.push(...status.reasons.map((reason) => `${prefix}: ${reason}`));
    }
    if (status.busy) {
      warnings.push(`${prefix}: model is currently busy or queued`);
    }
  }
  for (const role of RESEARCH_MODEL_ROLES) {
    if (!params.certifiedRoles.has(role)) {
      issues.push(`No reachable, compatible, qualified model is available for role ${role}.`);
    }
  }
  for (const probe of params.probes) {
    if (!probe.ok) {
      issues.push(`${probe.modelId}: live probe failed${probe.error ? `: ${probe.error}` : ""}`);
    }
  }
  if (params.webSearchProviders.length === 0) {
    issues.push("No web-search provider is registered.");
  } else if (params.webSearchProbe && !params.webSearchProbe.ok) {
    issues.push(
      `Live web-search probe failed${params.webSearchProbe.error ? `: ${params.webSearchProbe.error}` : "."}`,
    );
  }
  return {
    issues: [...new Set(issues)].toSorted(),
    warnings: [...new Set(warnings)].toSorted(),
  };
}

export type ResearchManagerDoctorReport = {
  ok: boolean;
  checkedAt: string;
  nodeVersion: string;
  openclawVersion: string;
  ollama: OllamaInventory;
  webSearchProviders: string[];
  webSearchProbe?: DoctorWebSearchProbe;
  models: ReturnType<ModelCapabilityRegistry["snapshot"]>;
  probes: ModelProbeResult[];
  qualifications: Awaited<ReturnType<ResearchRunStore["listQualifications"]>>;
  resourceLimits: ResolvedResearchManagerConfig["resourceLimits"];
  scheduler: ReturnType<ResourceScheduler["snapshot"]>;
  storage: ResearchRunStore["storage"];
  issues: string[];
  warnings: string[];
};

export type ResearchReplayProfile = "hybrid" | "sol-only";
export { createResearchReplaySeed } from "./replay.js";

export function createCancelledResearchReport(
  current: ResearchRunReport,
  now = new Date().toISOString(),
): ResearchRunReport {
  if (current.status === "completed" || current.status === "cancelled") {
    return current;
  }
  const cancelled: ResearchRunReport = {
    ...current,
    status: "cancelled",
    completedAt: now,
  };
  delete cancelled.blockedReason;
  delete cancelled.failure;
  return cancelled;
}

export class ResearchManagerRuntime {
  readonly api: OpenClawPluginApi;
  readonly config: ResolvedResearchManagerConfig;
  readonly registry: ModelCapabilityRegistry;
  readonly scheduler: ResourceScheduler;
  readonly runner: StructuredModelRunner;
  readonly store: ResearchRunStore;
  readonly #activeRuns = new Map<string, AbortController>();
  #prepared = false;

  constructor(api: OpenClawPluginApi, configOverride?: ResolvedResearchManagerConfig) {
    this.api = api;
    this.config = configOverride ?? resolveResearchManagerConfig(api.pluginConfig);
    this.registry = new ModelCapabilityRegistry(this.config);
    this.scheduler = new ResourceScheduler({
      config: this.config,
      inventoryReader: async () => await readOllamaInventory({ config: this.api.config }),
    });
    this.runner = new StructuredModelRunner({
      api,
      config: this.config,
      registry: this.registry,
      scheduler: this.scheduler,
    });
    this.store = new ResearchRunStore(api, this.config);
  }

  async prepare(force = false): Promise<void> {
    if (this.#prepared && !force) {
      return;
    }
    const [inventory, qualifications, corpus] = await Promise.all([
      this.scheduler.refresh(),
      this.store.listQualifications(),
      loadEvaluationCorpus(),
    ]);
    this.registry.updateOllamaInventory(inventory);
    this.registry.resetQualifications();
    for (const record of qualifications) {
      if (
        qualificationMatchesCorpus(record, corpus) &&
        RESEARCH_MODEL_ROLES.has(record.role as ResearchModelRole)
      ) {
        this.registry.recordQualification(
          record.modelId,
          record.role as ResearchModelRole,
          record.qualified === false ? 0 : record.score,
          record.latencyMs,
        );
      }
    }
    this.#prepared = true;
  }

  async run(
    request: ResearchRunRequest,
    ctx?: OpenClawPluginToolContext,
    signal?: AbortSignal,
  ): Promise<ResearchRunReport> {
    await this.prepare();
    const runId = request.runId ?? randomUUID();
    if (this.#activeRuns.has(runId)) {
      throw new Error(`Research run ${runId} is already active.`);
    }
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) {
      abort();
    } else {
      signal?.addEventListener("abort", abort, { once: true });
    }
    this.#activeRuns.set(runId, controller);
    try {
      return await runResearchPipeline({
        runtime: this,
        request: { ...request, runId },
        ctx,
        signal: controller.signal,
      });
    } finally {
      signal?.removeEventListener("abort", abort);
      if (this.#activeRuns.get(runId) === controller) {
        this.#activeRuns.delete(runId);
      }
    }
  }

  async resume(
    runId: string,
    ctx?: OpenClawPluginToolContext,
    signal?: AbortSignal,
  ): Promise<ResearchRunReport> {
    const existing = await this.store.load(runId);
    if (!existing) {
      throw new Error(`Research run ${runId} was not found.`);
    }
    return await this.run(
      {
        runId,
        query: existing.query,
        mode: existing.mode,
        highStakes: existing.plan?.riskLevel === "high",
      },
      ctx,
      signal,
    );
  }

  async replay(
    sourceRunId: string,
    options: { profile?: ResearchReplayProfile; signal?: AbortSignal } = {},
  ): Promise<ResearchRunReport> {
    const source = await this.store.load(sourceRunId);
    if (!source) {
      throw new Error(`Research run ${sourceRunId} was not found.`);
    }
    const target =
      options.profile === "sol-only"
        ? new ResearchManagerRuntime(this.api, createSolOnlyConfig(this.config))
        : this;
    await target.prepare(true);
    const runId = `replay-${randomUUID()}`;
    await target.store.create(createResearchReplaySeed({ source, runId }));
    return await target.run(
      {
        runId,
        query: source.query,
        mode: source.mode,
        highStakes: source.plan?.riskLevel === "high",
      },
      undefined,
      options.signal,
    );
  }

  async cancel(runId: string): Promise<ResearchRunReport> {
    this.#activeRuns.get(runId)?.abort();
    return await this.store.update(runId, (current) => createCancelledResearchReport(current));
  }

  async bakeoff(params: {
    modelId: string;
    roles?: ResearchModelRole[];
    persistQualifications?: boolean;
  }): Promise<ModelBakeoffReceipt> {
    await this.prepare(true);
    return await runModelBakeoff({ runtime: this, ...params });
  }

  async acceptance(
    params: {
      taskIds?: string[];
      receiptId?: string;
      signal?: AbortSignal;
      onProgress?: (receipt: AcceptanceBenchmarkReceipt) => void | Promise<void>;
    } = {},
  ): Promise<AcceptanceBenchmarkReceipt> {
    await this.prepare(true);
    const solOnlyRuntime = new ResearchManagerRuntime(this.api, createSolOnlyConfig(this.config));
    await solOnlyRuntime.prepare(true);
    return await runAcceptanceBenchmark({
      hybridRuntime: this,
      solOnlyRuntime,
      ...params,
    });
  }

  async doctor(live = false): Promise<ResearchManagerDoctorReport> {
    await this.prepare(true);
    const inventory = this.scheduler.inventory as OllamaInventory;
    const probes: ModelProbeResult[] = [];
    let webSearchProbe: DoctorWebSearchProbe | undefined;
    if (live) {
      const probesByIdentity = new Map<string, ModelProbeResult>();
      for (const model of this.config.models.filter((entry) => entry.enabled)) {
        const identity = modelProbeIdentity(model);
        const existing = probesByIdentity.get(identity);
        if (existing) {
          const reused = {
            ...existing,
            modelId: model.id,
            durationMs: 0,
            reusedFromModelId: existing.modelId,
          };
          probes.push(reused);
          if (model.remote) {
            this.registry.recordRemoteProbe(model.id, reused.ok);
          }
          continue;
        }
        const probe = await this.runner.probeModel(model);
        probesByIdentity.set(identity, probe);
        probes.push(probe);
      }
      const searchStartedAt = Date.now();
      try {
        const response = await this.api.runtime.webSearch.search({
          config: this.api.config,
          args: {
            query: "site:sqlite.org WAL database concurrency",
            count: 3,
          },
          signal: AbortSignal.timeout(30_000),
          preferRuntimeProviders: true,
        });
        const resultCount = collectSearchCandidates(response.result).length;
        webSearchProbe = {
          ok: resultCount > 0,
          provider: response.provider,
          resultCount,
          durationMs: Date.now() - searchStartedAt,
          ...(resultCount === 0 ? { error: "provider returned no public HTTP results" } : {}),
        };
      } catch (error) {
        webSearchProbe = {
          ok: false,
          resultCount: 0,
          durationMs: Date.now() - searchStartedAt,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      await this.prepare(true);
    }
    const scheduler = this.scheduler.snapshot();
    const activeByModel = new Map<string, number>();
    for (const active of scheduler.active) {
      activeByModel.set(active.modelId, (activeByModel.get(active.modelId) ?? 0) + 1);
    }
    const queuedModels = new Set(scheduler.queued.map((entry) => entry.modelId));
    const models = this.registry
      .snapshot({
        planner: 16_000,
        scout: 8_000,
        researcher: 24_000,
        verifier: 32_000,
        critic: 24_000,
        finalizer: 64_000,
      })
      .map((status) =>
        Object.assign({}, status, {
          busy:
            (activeByModel.get(status.model.id) ?? 0) >= status.model.maxParallel ||
            queuedModels.has(status.model.id),
        }),
      );
    const webSearchProviders = this.api.runtime.webSearch
      .listProviders({ config: this.api.config })
      .map((provider) => provider.id);
    const qualifications = await this.store.listQualifications();
    const certifiedRoles = new Set(
      [...RESEARCH_MODEL_ROLES].filter(
        (role) => this.registry.candidates({ role, mode: "certified" }).length > 0,
      ),
    );
    const { issues, warnings } = assessDoctorReadiness({
      models,
      probes,
      webSearchProviders,
      webSearchProbe,
      certifiedRoles,
    });
    return {
      ok: issues.length === 0,
      checkedAt: new Date().toISOString(),
      nodeVersion: process.version,
      openclawVersion: this.api.runtime.version,
      ollama: inventory,
      webSearchProviders,
      ...(webSearchProbe ? { webSearchProbe } : {}),
      models,
      probes,
      qualifications,
      resourceLimits: this.config.resourceLimits,
      scheduler,
      storage: this.store.storage,
      issues,
      warnings,
    };
  }
}

const RUNTIMES = new WeakMap<OpenClawPluginApi, ResearchManagerRuntime>();

export function getResearchManagerRuntime(api: OpenClawPluginApi): ResearchManagerRuntime {
  const existing = RUNTIMES.get(api);
  if (existing) {
    return existing;
  }
  const runtime = new ResearchManagerRuntime(api);
  RUNTIMES.set(api, runtime);
  return runtime;
}

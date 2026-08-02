import type { OpenClawPluginApi } from "../api.js";
import type { AcceptanceBenchmarkReceipt } from "./acceptance.js";
import type { ResolvedResearchManagerConfig } from "./config.js";
import type { ModelBakeoffReceipt } from "./evaluation.js";
import {
  createResearchStateStores,
  type KeyedStore,
  type ResearchStateStorage,
} from "./state-store.js";
import type { ResearchRunReport } from "./types.js";

export type ModelQualificationRecord = {
  modelId: string;
  role: string;
  score: number;
  qualified?: boolean;
  threshold?: number;
  taskCount?: number;
  schemaAdherence?: number;
  crashRate?: number;
  latencyMs?: { p50: number; p95: number; mean: number };
  corpusVersion: string;
  corpusSha256?: string;
  measuredAt: string;
  evidencePath?: string;
};

export class ResearchRunStore {
  readonly #runs: KeyedStore<ResearchRunReport>;
  readonly #qualifications: KeyedStore<ModelQualificationRecord>;
  readonly #evaluations: KeyedStore<ModelBakeoffReceipt>;
  readonly #acceptance: KeyedStore<AcceptanceBenchmarkReceipt>;
  readonly #ttlMs: number;
  readonly #updates = new Map<string, Promise<ResearchRunReport>>();
  readonly storage: ResearchStateStorage;

  constructor(api: OpenClawPluginApi, config: ResolvedResearchManagerConfig) {
    this.#ttlMs = config.stateTtlDays * 24 * 60 * 60 * 1000;
    const state = createResearchStateStores(api);
    this.#runs = state.open<ResearchRunReport>({
      namespace: "research-manager-runs",
      maxEntries: 512,
      defaultTtlMs: this.#ttlMs,
      largeValues: true,
    });
    this.#qualifications = state.open<ModelQualificationRecord>({
      namespace: "research-manager-qualifications",
      maxEntries: 512,
    });
    this.#evaluations = state.open<ModelBakeoffReceipt>({
      namespace: "research-manager-evaluations",
      maxEntries: 256,
    });
    this.#acceptance = state.open<AcceptanceBenchmarkReceipt>({
      namespace: "research-manager-acceptance",
      maxEntries: 64,
    });
    this.storage = state.storage();
  }

  async create(report: ResearchRunReport): Promise<void> {
    const created = await this.#runs.registerIfAbsent(report.runId, report, { ttlMs: this.#ttlMs });
    if (!created) {
      throw new Error(`Research run ${report.runId} already exists.`);
    }
  }

  async load(runId: string): Promise<ResearchRunReport | undefined> {
    return await this.#runs.lookup(runId);
  }

  async save(report: ResearchRunReport): Promise<void> {
    await this.#runs.register(report.runId, report, { ttlMs: this.#ttlMs });
  }

  async update(
    runId: string,
    mutate: (current: ResearchRunReport) => ResearchRunReport | Promise<ResearchRunReport>,
  ): Promise<ResearchRunReport> {
    const previous: Promise<unknown> = this.#updates.get(runId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const current = await this.load(runId);
        if (!current) {
          throw new Error(`Research run ${runId} was not found.`);
        }
        const updated = await mutate(current);
        const normalized = { ...updated, runId, updatedAt: new Date().toISOString() };
        await this.save(normalized);
        return normalized;
      });
    this.#updates.set(runId, next);
    try {
      return await next;
    } finally {
      if (this.#updates.get(runId) === next) {
        this.#updates.delete(runId);
      }
    }
  }

  async list(): Promise<ResearchRunReport[]> {
    const entries = await this.#runs.entries();
    return entries
      .map((entry) => entry.value)
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async delete(runId: string): Promise<boolean> {
    return await this.#runs.delete(runId);
  }

  async saveQualification(record: ModelQualificationRecord): Promise<void> {
    await this.#qualifications.register(`${record.modelId}:${record.role}`, record);
  }

  async listQualifications(): Promise<ModelQualificationRecord[]> {
    return (await this.#qualifications.entries()).map((entry) => entry.value);
  }

  async saveEvaluation(receipt: ModelBakeoffReceipt): Promise<void> {
    await this.#evaluations.register(receipt.receiptId, receipt);
  }

  async listEvaluations(): Promise<ModelBakeoffReceipt[]> {
    return (await this.#evaluations.entries())
      .map((entry) => entry.value)
      .toSorted((left, right) => right.completedAt.localeCompare(left.completedAt));
  }

  async saveAcceptance(receipt: AcceptanceBenchmarkReceipt): Promise<void> {
    await this.#acceptance.register(receipt.receiptId, receipt);
  }

  async loadAcceptance(receiptId: string): Promise<AcceptanceBenchmarkReceipt | undefined> {
    return await this.#acceptance.lookup(receiptId);
  }

  async listAcceptance(): Promise<AcceptanceBenchmarkReceipt[]> {
    return (await this.#acceptance.entries())
      .map((entry) => entry.value)
      .toSorted((left, right) => right.startedAt.localeCompare(left.startedAt));
  }
}

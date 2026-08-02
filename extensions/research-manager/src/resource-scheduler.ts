import { randomUUID } from "node:crypto";
import type { ResolvedResearchManagerConfig } from "./config.js";
import { ResearchBlockedError } from "./errors.js";
import { findOllamaModel, normalizeOllamaModelName, type OllamaInventory } from "./ollama.js";
import type { ResearchModelSpec } from "./types.js";

export type SchedulerPriority = "normal" | "high" | "critical";

export type ResourceReservation = {
  id: string;
  model: ResearchModelSpec;
  reservedMemoryGb: number;
  projectedMemoryGb: number;
  waitedMs: number;
  release: () => void;
};

type PendingReservation = {
  id: string;
  model: ResearchModelSpec;
  priority: SchedulerPriority;
  enqueuedAt: number;
  deadlineAt: number;
  resolve: (reservation: ResourceReservation) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abortHandler?: () => void;
  timeout: ReturnType<typeof setTimeout>;
};

type ActiveReservation = {
  id: string;
  model: ResearchModelSpec;
  reservedMemoryGb: number;
  contextReservationGb: number;
};

const PRIORITY_WEIGHT: Record<SchedulerPriority, number> = {
  normal: 0,
  high: 1,
  critical: 2,
};

const BYTES_PER_GB = 1024 ** 3;
const INVENTORY_RECHECK_MS = 1_000;

export class ResourceScheduler {
  readonly #limits: ResolvedResearchManagerConfig["resourceLimits"];
  readonly #inventoryReader: () => Promise<OllamaInventory>;
  readonly #active = new Map<string, ActiveReservation>();
  readonly #pending: PendingReservation[] = [];
  #inventory?: OllamaInventory;
  #pumping = false;
  #repumpTimer?: ReturnType<typeof setTimeout>;

  constructor(params: {
    config: ResolvedResearchManagerConfig;
    inventoryReader: () => Promise<OllamaInventory>;
  }) {
    this.#limits = params.config.resourceLimits;
    this.#inventoryReader = params.inventoryReader;
  }

  get queueLength(): number {
    return this.#pending.length;
  }

  get activeCount(): number {
    return this.#active.size;
  }

  get inventory(): OllamaInventory | undefined {
    return this.#inventory;
  }

  async refresh(): Promise<OllamaInventory> {
    this.#inventory = await this.#inventoryReader();
    return this.#inventory;
  }

  snapshot(): {
    active: Array<{ id: string; modelId: string; local: boolean; reservedMemoryGb: number }>;
    queued: Array<{ id: string; modelId: string; priority: SchedulerPriority; waitedMs: number }>;
    loadedMemoryGb: number;
  } {
    return {
      active: [...this.#active.values()].map((entry) => ({
        id: entry.id,
        modelId: entry.model.id,
        local: !entry.model.remote,
        reservedMemoryGb: entry.reservedMemoryGb,
      })),
      queued: this.#pending.map((entry) => ({
        id: entry.id,
        modelId: entry.model.id,
        priority: entry.priority,
        waitedMs: Date.now() - entry.enqueuedAt,
      })),
      loadedMemoryGb: (this.#inventory?.totalLoadedBytes ?? 0) / BYTES_PER_GB,
    };
  }

  async acquire(params: {
    model: ResearchModelSpec;
    priority?: SchedulerPriority;
    deadlineMs?: number;
    signal?: AbortSignal;
  }): Promise<ResourceReservation> {
    if (params.signal?.aborted) {
      throw new ResearchBlockedError("deadline_exceeded", "Resource reservation was cancelled.");
    }
    if (this.#pending.length >= this.#limits.queueLimit) {
      throw new ResearchBlockedError(
        "model_busy",
        `Research model queue is full (${this.#limits.queueLimit}).`,
      );
    }
    const id = randomUUID();
    const enqueuedAt = Date.now();
    const deadlineMs = Math.max(1, params.deadlineMs ?? this.#limits.queueDeadlineMs);
    const pending = await new Promise<ResourceReservation>((resolve, reject) => {
      const entry: PendingReservation = {
        id,
        model: params.model,
        priority: params.priority ?? "normal",
        enqueuedAt,
        deadlineAt: enqueuedAt + deadlineMs,
        resolve,
        reject,
        signal: params.signal,
        timeout: setTimeout(() => {
          this.#removePending(id);
          reject(
            new ResearchBlockedError(
              "model_busy",
              `Timed out waiting for ${params.model.id} after ${deadlineMs} ms.`,
              { modelId: params.model.id, deadlineMs },
            ),
          );
        }, deadlineMs),
      };
      if (params.signal) {
        entry.abortHandler = () => {
          if (this.#removePending(id)) {
            reject(
              new ResearchBlockedError("deadline_exceeded", "Resource reservation was cancelled."),
            );
          }
        };
        params.signal.addEventListener("abort", entry.abortHandler, { once: true });
      }
      this.#pending.push(entry);
      void this.#pump();
    });
    return pending;
  }

  #removePending(id: string): boolean {
    const index = this.#pending.findIndex((entry) => entry.id === id);
    if (index < 0) {
      return false;
    }
    const [entry] = this.#pending.splice(index, 1);
    if (entry) {
      clearTimeout(entry.timeout);
      if (entry.signal && entry.abortHandler) {
        entry.signal.removeEventListener("abort", entry.abortHandler);
      }
    }
    if (this.#pending.length === 0 && this.#repumpTimer) {
      clearTimeout(this.#repumpTimer);
      this.#repumpTimer = undefined;
    }
    return true;
  }

  #activeForModel(modelId: string): ActiveReservation[] {
    return [...this.#active.values()].filter((entry) => entry.model.id === modelId);
  }

  #estimateReservation(model: ResearchModelSpec): {
    fits: boolean;
    reservedMemoryGb: number;
    projectedMemoryGb: number;
    contextReservationGb: number;
  } {
    const activeForModel = this.#activeForModel(model.id);
    if (activeForModel.length >= model.maxParallel) {
      return {
        fits: false,
        reservedMemoryGb: 0,
        projectedMemoryGb: 0,
        contextReservationGb: 0,
      };
    }
    if (model.remote) {
      return {
        fits: true,
        reservedMemoryGb: 0,
        projectedMemoryGb: 0,
        contextReservationGb: 0,
      };
    }

    const localActive = [...this.#active.values()].filter((entry) => !entry.model.remote);
    if (localActive.length >= this.#limits.maxLocalParallel) {
      return {
        fits: false,
        reservedMemoryGb: 0,
        projectedMemoryGb: 0,
        contextReservationGb: 0,
      };
    }
    if (model.exclusive && localActive.length > 0) {
      return {
        fits: false,
        reservedMemoryGb: 0,
        projectedMemoryGb: 0,
        contextReservationGb: 0,
      };
    }
    if (localActive.some((entry) => entry.model.exclusive)) {
      return {
        fits: false,
        reservedMemoryGb: 0,
        projectedMemoryGb: 0,
        contextReservationGb: 0,
      };
    }

    const inventory = this.#inventory;
    const loadedMemoryGb = (inventory?.totalLoadedBytes ?? 0) / BYTES_PER_GB;
    const loaded = inventory ? Boolean(findOllamaModel(inventory, model.model)?.loaded) : false;
    const loadedModelNames = new Set(
      (inventory?.models ?? [])
        .filter((entry) => entry.loaded)
        .map((entry) => normalizeOllamaModelName(entry.model || entry.name)),
    );
    const activeDistinct = new Map<string, ResearchModelSpec>();
    for (const entry of localActive) {
      activeDistinct.set(normalizeOllamaModelName(entry.model.model), entry.model);
    }
    let unmaterializedGb = 0;
    for (const activeModel of activeDistinct.values()) {
      const activeLoaded = inventory
        ? Boolean(findOllamaModel(inventory, activeModel.model)?.loaded)
        : false;
      if (!activeLoaded) {
        unmaterializedGb += activeModel.memoryGb;
      }
    }
    const normalizedModelName = normalizeOllamaModelName(model.model);
    const projectedLoadedModelNames = new Set([...loadedModelNames, ...activeDistinct.keys()]);
    if (
      !projectedLoadedModelNames.has(normalizedModelName) &&
      projectedLoadedModelNames.size >= this.#limits.maxLoadedModels
    ) {
      return {
        fits: false,
        reservedMemoryGb: 0,
        projectedMemoryGb: 0,
        contextReservationGb: 0,
      };
    }
    const sameWeightsReserved = activeDistinct.has(normalizedModelName);
    const weightReservationGb = loaded || sameWeightsReserved ? 0 : model.memoryGb;
    const contextReservationGb = Math.max(2, Math.min(8, model.memoryGb * 0.12));
    const activeContextGb = localActive.reduce((sum, entry) => sum + entry.contextReservationGb, 0);
    const reservedMemoryGb = weightReservationGb + contextReservationGb;
    const projectedMemoryGb =
      loadedMemoryGb + unmaterializedGb + activeContextGb + reservedMemoryGb;
    return {
      fits: projectedMemoryGb <= this.#limits.absoluteMemoryGb,
      reservedMemoryGb,
      projectedMemoryGb,
      contextReservationGb,
    };
  }

  async #pump(): Promise<void> {
    if (this.#pumping) {
      return;
    }
    this.#pumping = true;
    try {
      if (this.#pending.some((entry) => !entry.model.remote)) {
        await this.refresh().catch(() => undefined);
      }
      let progress = true;
      while (progress) {
        progress = false;
        const now = Date.now();
        const ordered = this.#pending.toSorted((left, right) => {
          const leftAgedPriority =
            PRIORITY_WEIGHT[left.priority] + (now - left.enqueuedAt) / 60_000;
          const rightAgedPriority =
            PRIORITY_WEIGHT[right.priority] + (now - right.enqueuedAt) / 60_000;
          return rightAgedPriority - leftAgedPriority || left.enqueuedAt - right.enqueuedAt;
        });
        for (const pending of ordered) {
          if (pending.deadlineAt <= now || pending.signal?.aborted) {
            continue;
          }
          const estimate = this.#estimateReservation(pending.model);
          if (!estimate.fits) {
            continue;
          }
          if (
            !pending.model.remote &&
            estimate.projectedMemoryGb > this.#limits.softMemoryGb &&
            (pending.priority !== "critical" ||
              estimate.projectedMemoryGb >
                (pending.model.exclusive
                  ? this.#limits.absoluteMemoryGb
                  : this.#limits.hardMemoryGb))
          ) {
            continue;
          }
          if (!this.#removePending(pending.id)) {
            continue;
          }
          const active: ActiveReservation = {
            id: pending.id,
            model: pending.model,
            reservedMemoryGb: estimate.reservedMemoryGb,
            contextReservationGb: estimate.contextReservationGb,
          };
          this.#active.set(active.id, active);
          let released = false;
          pending.resolve({
            id: active.id,
            model: active.model,
            reservedMemoryGb: active.reservedMemoryGb,
            projectedMemoryGb: estimate.projectedMemoryGb,
            waitedMs: Date.now() - pending.enqueuedAt,
            release: () => {
              if (released) {
                return;
              }
              released = true;
              this.#active.delete(active.id);
              void this.#pump();
            },
          });
          progress = true;
          break;
        }
      }
    } finally {
      this.#pumping = false;
      this.#scheduleRepump();
    }
  }

  #scheduleRepump(): void {
    if (this.#repumpTimer || this.#pending.length === 0) {
      return;
    }
    const remainingMs = Math.max(
      1,
      Math.min(...this.#pending.map((entry) => entry.deadlineAt - Date.now())),
    );
    this.#repumpTimer = setTimeout(
      () => {
        this.#repumpTimer = undefined;
        void this.#pump();
      },
      Math.min(INVENTORY_RECHECK_MS, remainingMs),
    );
  }
}

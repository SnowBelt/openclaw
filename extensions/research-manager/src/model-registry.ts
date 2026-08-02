import type { ResolvedResearchManagerConfig } from "./config.js";
import { findOllamaModel, type OllamaInventory } from "./ollama.js";
import type { ResearchMode, ResearchModelRole, ResearchModelSpec } from "./types.js";

export type ModelCapabilityStatus = {
  model: ResearchModelSpec;
  role: ResearchModelRole;
  configured: boolean;
  reachable: boolean | "unknown";
  installed: boolean | "unknown";
  loaded: boolean | "unknown";
  compatible: boolean;
  qualified: boolean;
  qualificationLatencyMs?: { p50: number; p95: number; mean: number };
  busy: boolean | "unknown";
  reasons: string[];
};

export const ROLE_QUALIFICATION_THRESHOLDS: Record<ResearchModelRole, number> = {
  planner: 93,
  scout: 75,
  researcher: 82,
  verifier: 90,
  critic: 88,
  finalizer: 93,
};

export function isSolModel(model: ResearchModelSpec): boolean {
  return /(^|[-_/])gpt-?5\.6-?sol($|[-_/:])/i.test(
    `${model.provider}/${model.model}`.replace(/\s+/g, ""),
  );
}

export function isSolOnlyModelSet(models: ResearchModelSpec[]): boolean {
  const enabled = models.filter((model) => model.enabled);
  return enabled.length > 0 && enabled.every(isSolModel);
}

export class ModelCapabilityRegistry {
  readonly #config: ResolvedResearchManagerConfig;
  #ollama?: OllamaInventory;
  readonly #remoteReachability = new Map<string, { reachable: boolean; checkedAt: number }>();
  readonly #qualificationOverrides = new Map<
    string,
    { score: number; latencyMs?: { p50: number; p95: number; mean: number } }
  >();

  constructor(config: ResolvedResearchManagerConfig) {
    this.#config = config;
  }

  updateOllamaInventory(inventory: OllamaInventory): void {
    this.#ollama = inventory;
  }

  recordRemoteProbe(modelId: string, reachable: boolean): void {
    this.#remoteReachability.set(modelId, { reachable, checkedAt: Date.now() });
  }

  recordQualification(
    modelId: string,
    role: ResearchModelRole,
    score: number,
    latencyMs?: { p50: number; p95: number; mean: number },
  ): void {
    this.#qualificationOverrides.set(`${modelId}:${role}`, {
      score: Math.max(0, Math.min(100, score)),
      ...(latencyMs ? { latencyMs } : {}),
    });
  }

  resetQualifications(): void {
    this.#qualificationOverrides.clear();
  }

  status(
    model: ResearchModelSpec,
    role: ResearchModelRole,
    requiredContextTokens = 0,
  ): ModelCapabilityStatus {
    const reasons: string[] = [];
    if (!model.enabled) {
      reasons.push("model is disabled");
    }
    if (!model.roles.includes(role)) {
      reasons.push(`model is not assigned to role ${role}`);
    }
    if (model.contextTokens < requiredContextTokens) {
      reasons.push(
        `context ${model.contextTokens} is below required ${requiredContextTokens} tokens`,
      );
    }
    const qualification = this.#qualificationOverrides.get(`${model.id}:${role}`);
    const effectiveModel = {
      ...model,
      qualificationScore: qualification?.score ?? model.qualificationScore,
    };
    const qualificationThreshold = ROLE_QUALIFICATION_THRESHOLDS[role];
    const qualified = effectiveModel.qualificationScore >= qualificationThreshold;
    if (!qualified) {
      reasons.push(
        `qualification ${effectiveModel.qualificationScore} is below ${role} threshold ${qualificationThreshold}`,
      );
    }

    if (model.remote) {
      const probe = this.#remoteReachability.get(model.id);
      return {
        model: effectiveModel,
        role,
        configured: model.enabled,
        reachable: probe?.reachable ?? "unknown",
        installed: "unknown",
        loaded: "unknown",
        compatible: model.contextTokens >= requiredContextTokens,
        qualified,
        ...(qualification?.latencyMs ? { qualificationLatencyMs: qualification.latencyMs } : {}),
        busy: "unknown",
        reasons,
      };
    }

    if (model.provider !== "ollama") {
      reasons.push(`unsupported local provider ${model.provider}`);
      return {
        model: effectiveModel,
        role,
        configured: model.enabled,
        reachable: false,
        installed: false,
        loaded: false,
        compatible: false,
        qualified,
        ...(qualification?.latencyMs ? { qualificationLatencyMs: qualification.latencyMs } : {}),
        busy: "unknown",
        reasons,
      };
    }

    const inventory = this.#ollama;
    const installed = inventory ? findOllamaModel(inventory, model.model) : undefined;
    if (inventory && !inventory.reachable) {
      reasons.push(`Ollama is unreachable${inventory.error ? `: ${inventory.error}` : ""}`);
    } else if (inventory && !installed) {
      reasons.push(`Ollama model ${model.model} is not installed`);
    }
    return {
      model: effectiveModel,
      role,
      configured: model.enabled,
      reachable: inventory?.reachable ?? "unknown",
      installed: inventory ? Boolean(installed) : "unknown",
      loaded: installed?.loaded ?? (inventory ? false : "unknown"),
      compatible: model.contextTokens >= requiredContextTokens,
      qualified,
      ...(qualification?.latencyMs ? { qualificationLatencyMs: qualification.latencyMs } : {}),
      busy: "unknown",
      reasons,
    };
  }

  candidates(params: {
    role: ResearchModelRole;
    mode: ResearchMode;
    requiredContextTokens?: number;
  }): ModelCapabilityStatus[] {
    const statuses = this.#config.models
      .filter((model) => model.enabled && model.roles.includes(params.role))
      .map((model) => this.status(model, params.role, params.requiredContextTokens ?? 0))
      .filter((status) => status.compatible)
      .filter((status) => params.mode === "best-effort" || status.qualified)
      .filter((status) => status.reachable !== false && status.installed !== false);

    const frontierRole = params.role === "planner" || params.role === "finalizer";
    return statuses.toSorted((left, right) => {
      if (frontierRole) {
        const solOrder = Number(isSolModel(right.model)) - Number(isSolModel(left.model));
        if (solOrder !== 0) {
          return solOrder;
        }
      } else {
        const localOrder = Number(left.model.remote) - Number(right.model.remote);
        if (localOrder !== 0) {
          return localOrder;
        }
      }
      return (
        right.model.qualificationScore - left.model.qualificationScore ||
        (left.qualificationLatencyMs?.mean ?? Number.POSITIVE_INFINITY) -
          (right.qualificationLatencyMs?.mean ?? Number.POSITIVE_INFINITY) ||
        right.model.contextTokens - left.model.contextTokens ||
        left.model.id.localeCompare(right.model.id)
      );
    });
  }

  snapshot(
    requiredContextTokens: Partial<Record<ResearchModelRole, number>> = {},
  ): ModelCapabilityStatus[] {
    return this.#config.models.flatMap((model) =>
      model.roles.map((role) => this.status(model, role, requiredContextTokens[role] ?? 0)),
    );
  }
}

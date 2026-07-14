import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { withFileLock } from "../infra/file-lock.js";
import { readDurableJsonFile, writeTextAtomic } from "../infra/json-files.js";
import type { ModelRouteKind } from "./model-catalog.types.js";
import {
  resolveAutomaticModelSpendEstimate,
  resolveModelRouteForRef,
} from "./model-routing-policy.js";

const LEDGER_VERSION = 1;
const MAX_RETAINED_DAYS = 35;
const SPEND_LEDGER_LOCK_OPTIONS = {
  retries: {
    retries: 8,
    factor: 2,
    minTimeout: 50,
    maxTimeout: 5_000,
    randomize: true,
  },
  stale: 15_000,
} as const;

type AutomaticDailySpendReservation = {
  at: number;
  amountUsd: number;
  agentId: string;
  projectId?: string;
  candidates: string[];
};

type AutomaticDailyAgentSpend = {
  reservedUsd: number;
  reservations: AutomaticDailySpendReservation[];
};

type AutomaticDailySpendLedger = {
  version: 1;
  days: Record<
    string,
    {
      agents: Record<string, AutomaticDailyAgentSpend>;
      projects: Record<string, AutomaticDailyAgentSpend>;
    }
  >;
};

export type AutomaticDailySpendBudgetResult<T> = {
  candidates: T[];
  blocked: Array<T & { route: ModelRouteKind }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function resolveLocalDayKey(nowMs: number): string {
  const now = new Date(nowMs);
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function createEmptyLedger(): AutomaticDailySpendLedger {
  return { version: LEDGER_VERSION, days: {} };
}

function normalizeLedger(value: unknown): AutomaticDailySpendLedger {
  if (value === null) {
    return createEmptyLedger();
  }
  if (!isRecord(value) || value.version !== LEDGER_VERSION || !isRecord(value.days)) {
    throw new Error("automatic model spend ledger is invalid");
  }
  const days: AutomaticDailySpendLedger["days"] = {};
  for (const [day, rawDay] of Object.entries(value.days)) {
    if (!isRecord(rawDay) || !isRecord(rawDay.agents) || !isRecord(rawDay.projects)) {
      throw new Error(`automatic model spend ledger day is invalid: ${day}`);
    }
    const normalizeSpendScope = (rawScopes: Record<string, unknown>) => {
      const scopes: Record<string, AutomaticDailyAgentSpend> = {};
      for (const [scopeId, rawScope] of Object.entries(rawScopes)) {
        if (!isRecord(rawScope)) {
          throw new Error(`automatic model spend ledger scope is invalid: ${scopeId}`);
        }
        const reservedUsd = finiteNonNegative(rawScope.reservedUsd);
        if (reservedUsd === undefined || !Array.isArray(rawScope.reservations)) {
          throw new Error(`automatic model spend ledger scope totals are invalid: ${scopeId}`);
        }
        const reservations = rawScope.reservations.map((rawReservation) => {
          if (!isRecord(rawReservation)) {
            throw new Error(`automatic model spend reservation is invalid: ${scopeId}`);
          }
          const at = finiteNonNegative(rawReservation.at);
          const amountUsd = finiteNonNegative(rawReservation.amountUsd);
          const agentId =
            typeof rawReservation.agentId === "string" ? rawReservation.agentId.trim() : "";
          const projectId =
            typeof rawReservation.projectId === "string"
              ? rawReservation.projectId.trim()
              : undefined;
          const rawCandidates = rawReservation.candidates;
          const candidates =
            Array.isArray(rawCandidates) &&
            rawCandidates.every(
              (candidate): candidate is string => typeof candidate === "string" && !!candidate,
            )
              ? rawCandidates
              : null;
          if (at === undefined || amountUsd === undefined || !agentId || !candidates) {
            throw new Error(`automatic model spend reservation fields are invalid: ${scopeId}`);
          }
          return { at, amountUsd, agentId, ...(projectId ? { projectId } : {}), candidates };
        });
        const reservationTotal = reservations.reduce(
          (total, reservation) => total + reservation.amountUsd,
          0,
        );
        scopes[scopeId] = { reservedUsd: Math.max(reservedUsd, reservationTotal), reservations };
      }
      return scopes;
    };
    days[day] = {
      agents: normalizeSpendScope(rawDay.agents),
      projects: normalizeSpendScope(rawDay.projects),
    };
  }
  return { version: LEDGER_VERSION, days };
}

function pruneLedgerDays(ledger: AutomaticDailySpendLedger): void {
  const obsolete = Object.keys(ledger.days)
    .toSorted()
    .slice(0, Math.max(0, Object.keys(ledger.days).length - MAX_RETAINED_DAYS));
  for (const day of obsolete) {
    delete ledger.days[day];
  }
}

export function resolveAutomaticModelSpendLedgerPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveStateDir(env), "usage", "automatic-model-spend.json");
}

function buildFailClosedResult<T extends { provider: string; model: string }>(params: {
  cfg: Pick<OpenClawConfig, "models">;
  candidates: readonly T[];
}): AutomaticDailySpendBudgetResult<T> {
  const candidates: T[] = [];
  const blocked: Array<T & { route: ModelRouteKind }> = [];
  for (const candidate of params.candidates) {
    const route = resolveModelRouteForRef({
      cfg: params.cfg,
      provider: candidate.provider,
      model: candidate.model,
    });
    if (route === "local" || route === "subscription") {
      candidates.push(candidate);
    } else {
      blocked.push({ ...candidate, route });
    }
  }
  return { candidates, blocked };
}

/**
 * Atomically reserves a complete automatic metered fallback chain in a local,
 * durable ledger. A reservation remains until the next local calendar day so
 * a crash or delayed transcript write cannot reopen money that was already
 * authorized for automatic work.
 */
export async function reserveAutomaticDailySpendBudget<
  T extends { provider: string; model: string },
>(params: {
  cfg: Pick<OpenClawConfig, "models">;
  candidates: readonly T[];
  agentId?: string;
  projectId?: string;
  nowMs?: number;
  ledgerPath?: string;
}): Promise<AutomaticDailySpendBudgetResult<T>> {
  const agentCeiling = params.cfg.models?.routing?.automaticDailyMaxCostUsd;
  const projectCeiling = params.cfg.models?.routing?.automaticProjectDailyMaxCostUsd;
  if (agentCeiling === undefined && projectCeiling === undefined) {
    return { candidates: [...params.candidates], blocked: [] };
  }
  const ledgerPath = params.ledgerPath ?? resolveAutomaticModelSpendLedgerPath();
  const nowMs = params.nowMs ?? Date.now();
  const day = resolveLocalDayKey(nowMs);
  const agentId = params.agentId?.trim() || "main";
  const projectId = params.projectId?.trim();

  try {
    await fs.mkdir(path.dirname(ledgerPath), { recursive: true, mode: 0o700 });
    return await withFileLock(ledgerPath, SPEND_LEDGER_LOCK_OPTIONS, async () => {
      const ledger = normalizeLedger(await readDurableJsonFile(ledgerPath));
      const daily = ledger.days[day] ?? { agents: {}, projects: {} };
      const agentDaily = daily.agents[agentId] ?? { reservedUsd: 0, reservations: [] };
      const projectDaily = projectId
        ? (daily.projects[projectId] ?? { reservedUsd: 0, reservations: [] })
        : undefined;
      let agentReservedUsd = agentDaily.reservedUsd;
      let projectReservedUsd = projectDaily?.reservedUsd ?? 0;
      const candidates: T[] = [];
      const blocked: Array<T & { route: ModelRouteKind }> = [];
      const reservedCandidates: string[] = [];
      let addedReservationUsd = 0;

      for (const candidate of params.candidates) {
        const route = resolveModelRouteForRef({
          cfg: params.cfg,
          provider: candidate.provider,
          model: candidate.model,
        });
        if (route === "local" || route === "subscription") {
          candidates.push(candidate);
          continue;
        }
        if (route === "unknown" || (projectCeiling !== undefined && !projectId)) {
          blocked.push({ ...candidate, route });
          continue;
        }
        const estimate = resolveAutomaticModelSpendEstimate({
          cfg: params.cfg,
          provider: candidate.provider,
          model: candidate.model,
        });
        if (
          !estimate ||
          (agentCeiling !== undefined &&
            agentReservedUsd + estimate.maximumCostUsd > agentCeiling) ||
          (projectCeiling !== undefined &&
            projectReservedUsd + estimate.maximumCostUsd > projectCeiling)
        ) {
          blocked.push({ ...candidate, route });
          continue;
        }
        if (agentCeiling !== undefined) {
          agentReservedUsd += estimate.maximumCostUsd;
        }
        if (projectCeiling !== undefined) {
          projectReservedUsd += estimate.maximumCostUsd;
        }
        addedReservationUsd += estimate.maximumCostUsd;
        reservedCandidates.push(`${candidate.provider}/${candidate.model}`);
        candidates.push(candidate);
      }

      if (addedReservationUsd > 0) {
        const reservation = {
          at: nowMs,
          amountUsd: addedReservationUsd,
          agentId,
          ...(projectId ? { projectId } : {}),
          candidates: reservedCandidates,
        };
        if (agentCeiling !== undefined) {
          daily.agents[agentId] = {
            reservedUsd: agentReservedUsd,
            reservations: [...agentDaily.reservations, reservation],
          };
        }
        if (projectCeiling !== undefined && projectId && projectDaily) {
          daily.projects[projectId] = {
            reservedUsd: projectReservedUsd,
            reservations: [...projectDaily.reservations, reservation],
          };
        }
        ledger.days[day] = daily;
        pruneLedgerDays(ledger);
        await writeTextAtomic(ledgerPath, JSON.stringify(ledger, null, 2), {
          mode: 0o600,
          dirMode: 0o700,
          trailingNewline: true,
        });
      }
      return { candidates, blocked };
    });
  } catch {
    return buildFailClosedResult({ cfg: params.cfg, candidates: params.candidates });
  }
}

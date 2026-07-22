import { getSafeLocalStorage } from "../../local-storage.ts";

export type OperationsAgentSort = "priority" | "name" | "recent";

export type OperationsPreferences = {
  agentSort: OperationsAgentSort;
  lastVisitedAt: number | null;
  pinnedAgentIds: string[];
};

const OPERATIONS_PREFERENCES_KEY = "openclaw.operations.preferences.v1";
const MAX_PINNED_AGENTS = 100;

const DEFAULT_OPERATIONS_PREFERENCES: OperationsPreferences = {
  agentSort: "priority",
  lastVisitedAt: null,
  pinnedAgentIds: [],
};

function isAgentSort(value: unknown): value is OperationsAgentSort {
  return value === "priority" || value === "name" || value === "recent";
}

function normalizePinnedAgentIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [
    ...new Set(
      value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ].slice(0, MAX_PINNED_AGENTS);
}

export function loadOperationsPreferences(): OperationsPreferences {
  const storage = getSafeLocalStorage();
  if (!storage) {
    return { ...DEFAULT_OPERATIONS_PREFERENCES };
  }
  try {
    const raw = storage.getItem(OPERATIONS_PREFERENCES_KEY);
    if (!raw) {
      return { ...DEFAULT_OPERATIONS_PREFERENCES };
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      agentSort: isAgentSort(parsed.agentSort) ? parsed.agentSort : "priority",
      lastVisitedAt:
        typeof parsed.lastVisitedAt === "number" && Number.isFinite(parsed.lastVisitedAt)
          ? parsed.lastVisitedAt
          : null,
      pinnedAgentIds: normalizePinnedAgentIds(parsed.pinnedAgentIds),
    };
  } catch {
    return { ...DEFAULT_OPERATIONS_PREFERENCES };
  }
}

export function saveOperationsPreferences(preferences: OperationsPreferences): void {
  const storage = getSafeLocalStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(
      OPERATIONS_PREFERENCES_KEY,
      JSON.stringify({
        agentSort: preferences.agentSort,
        lastVisitedAt:
          typeof preferences.lastVisitedAt === "number" &&
          Number.isFinite(preferences.lastVisitedAt)
            ? preferences.lastVisitedAt
            : null,
        pinnedAgentIds: normalizePinnedAgentIds(preferences.pinnedAgentIds),
      }),
    );
  } catch {
    // Browser storage can be unavailable in private or restricted contexts.
  }
}

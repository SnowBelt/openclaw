// Controller-enforced confirmation for worker-reported Pursue Goal blockers.

export const PURSUE_GOAL_BLOCKER_CONFIRMATION_TURNS = 3;

function normalizeBlocker(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[`'"“”‘’]/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

export function nextPursueGoalBlockerCount(params: {
  previousSummary?: string;
  previousCount: number;
  currentSummary: string;
}): number {
  const previous = normalizeBlocker(params.previousSummary);
  const current = normalizeBlocker(params.currentSummary);
  if (!current) {
    return 0;
  }
  return previous && previous === current ? params.previousCount + 1 : 1;
}

import type { SelfImprovementCapabilityRoutingEvidence } from "./signals.js";

export type SelfImprovementCapabilityRoutingDecision = {
  considered: string[];
  selected: string[];
  missed: string[];
  fallback: string[];
  recommended: string[];
  rationale: string;
};

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

/**
 * Chooses the narrowest evidence-backed capability set. It never performs a broad
 * capability catalog load and never invents capabilities absent from execution evidence.
 */
export function resolveSelfImprovementCapabilityRoutingDecision(
  evidence: SelfImprovementCapabilityRoutingEvidence | undefined,
): SelfImprovementCapabilityRoutingDecision | undefined {
  if (!evidence) {
    return undefined;
  }
  const considered = unique(evidence.considered);
  const selected = unique(evidence.selected);
  const missed = unique(evidence.missed);
  const fallback = unique(evidence.fallback);
  const recommended = (
    missed.length > 0
      ? missed
      : selected.length > 0
        ? selected
        : fallback.length > 0
          ? fallback
          : considered
  ).slice(0, 1);
  const rationale =
    missed.length > 0
      ? "Use the first missed capability that directly addresses the observed gap."
      : selected.length > 0
        ? "Reuse the smallest capability set that already handled the workflow."
        : fallback.length > 0
          ? "Use the first recorded fallback because no primary capability succeeded."
          : "Evaluate only the first considered capability; do not load the full catalog.";
  return { considered, selected, missed, fallback, recommended, rationale };
}

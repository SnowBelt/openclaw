import crypto from "node:crypto";
import type {
  SelfImprovementRecommendationCategory,
  SelfImprovementRecommendationSource,
} from "./types.js";

function stableSourceIdentity(source: SelfImprovementRecommendationSource): string {
  return Object.entries(source)
    .filter(([, value]) => typeof value === "string" && value.length > 0)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("|");
}

export function deriveSelfImprovementEvidenceKeys(params: {
  category: SelfImprovementRecommendationCategory;
  source: SelfImprovementRecommendationSource;
  title: string;
  evidence: readonly string[];
}): string[] {
  const evidence = params.evidence.length > 0 ? params.evidence : [params.title];
  const prefix = [params.category, stableSourceIdentity(params.source)].join("|");
  return [
    ...new Set(
      evidence.map((entry) =>
        crypto.createHash("sha256").update(`${prefix}|${entry}`).digest("hex"),
      ),
    ),
  ];
}

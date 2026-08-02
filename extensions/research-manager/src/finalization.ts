import type { ResolvedResearchManagerConfig } from "./config.js";
import { isSolOnlyModelSet } from "./model-registry.js";
import { StructuredModelRunner } from "./model-runner.js";
import { FINALIZATION_SCHEMA } from "./schemas.js";
import type { ResearchClaim, ResearchModelAttempt, ResearchPlan, ResearchSource } from "./types.js";

export type FinalizationResult = {
  answer: string;
  usedClaimIds: string[];
  limitations: string[];
  attempts: ResearchModelAttempt[];
};

export async function finalizeResearch(params: {
  runner: StructuredModelRunner;
  config: ResolvedResearchManagerConfig;
  mode: "certified" | "best-effort";
  query: string;
  plan: ResearchPlan;
  claims: ResearchClaim[];
  sources: ResearchSource[];
  priorAnswer?: string;
  repairFailures?: string[];
  deadlineMs?: number;
  signal?: AbortSignal;
  onAttempt?: (attempt: ResearchModelAttempt) => void | Promise<void>;
}): Promise<FinalizationResult> {
  const verifiedClaims = params.claims.filter((claim) => claim.status === "verified");
  const sourceIds = new Set(
    verifiedClaims.flatMap((claim) =>
      claim.evidence.filter((entry) => entry.supports).map((entry) => entry.sourceId),
    ),
  );
  const requiredSourceCount = Math.min(params.config.certification.minSources, sourceIds.size);
  const sourceIndex = params.sources
    .filter((source) => sourceIds.has(source.id))
    .map((source) => ({
      id: source.id,
      title: source.title,
      url: source.url,
      publishedAt: source.publishedAt ?? null,
      sourceType: source.sourceType,
    }));
  const run = await params.runner.runJson<{
    answer: string;
    usedClaimIds: string[];
    limitations: string[];
  }>({
    role: "finalizer",
    mode: params.mode,
    thinking: isSolOnlyModelSet(params.config.models) ? "max" : "xhigh",
    priority: "critical",
    requiredContextTokens: 64_000,
    deadlineMs: params.deadlineMs,
    maxTokens: 10_000,
    temperature: 0.1,
    schema: FINALIZATION_SCHEMA,
    signal: params.signal,
    onAttempt: params.onAttempt,
    prompt: [
      "Write the final research answer using only the verified claim ledger.",
      "Cite factual statements with source IDs in square brackets, for example [S3].",
      "Do not cite an unsupported or disputed claim. Do not introduce facts absent from the ledger.",
      "Do not mention or paraphrase unsupported or disputed claim content, even to reject it.",
      "Each factual sentence must stay within the direct entailment of its cited verified claim or claims. Do not create a new causal, temporal, mechanistic, or scope conclusion by combining separately verified facts.",
      "Preserve every material qualifier from the ledger, including defaults, connection boundaries, versions, dates, platforms, preconditions, uncertainty words, and exceptions. Never shorten a qualified claim into a broader assertion.",
      "Do not present a historical defect as a current production limitation unless the verified ledger establishes its affected versions or current applicability.",
      "Include an inferred recommendation only when the verified ledger itself contains that recommendation or inference; labeling a new assertion as an inference does not make it supported.",
      "Answer the user's actual question directly, distinguish fact from inference, and disclose material uncertainty.",
      "Cover every required plan question that has verified support. For any required question without verified support, state the evidence gap in limitations instead of silently omitting it or guessing.",
      `Use verified claims spanning at least ${requiredSourceCount} distinct independently supporting source IDs. The certification policy target is ${params.config.certification.minSources}; when the verified ledger contains fewer, use every available supporting source and disclose the shortfall. Do not add irrelevant claims merely to increase source count.`,
      "Include a concise Sources section mapping every used source ID to its title and URL.",
      params.priorAnswer
        ? "This is a targeted repair. Preserve supported content unless a listed gate failure requires a change."
        : "",
      params.repairFailures?.length
        ? `Gate failures to repair: ${JSON.stringify(params.repairFailures)}`
        : "",
      `User question: ${params.query}`,
      `Research plan: ${JSON.stringify(params.plan)}`,
      `VERIFIED_CLAIM_LEDGER_JSON: ${JSON.stringify(verifiedClaims)}`,
      `SOURCE_INDEX_JSON: ${JSON.stringify(sourceIndex)}`,
      params.priorAnswer ? `PRIOR_ANSWER: ${params.priorAnswer}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  });
  const validClaimIds = new Set(verifiedClaims.map((claim) => claim.id));
  return {
    answer: run.value.answer.trim(),
    usedClaimIds: [...new Set(run.value.usedClaimIds)].filter((id) => validClaimIds.has(id)),
    limitations: run.value.limitations.map((item) => item.trim()).filter(Boolean),
    attempts: run.attempts,
  };
}

import { resolvePlanProvenance } from "./plan-provenance.js";
import type { ResearchRunReport } from "./types.js";

export function createResearchReplaySeed(params: {
  source: ResearchRunReport;
  runId: string;
  now?: string;
}): ResearchRunReport {
  if (!params.source.plan || params.source.sources.length === 0) {
    throw new Error(`Research run ${params.source.runId} has no reusable plan and source corpus.`);
  }
  const now = params.now ?? new Date().toISOString();
  const planProvenance = resolvePlanProvenance(params.source);
  return {
    runId: params.runId,
    replayedFromRunId: params.source.runId,
    query: params.source.query,
    mode: params.source.mode,
    status: "queued",
    plan: structuredClone(params.source.plan),
    ...(planProvenance ? { planProvenance } : {}),
    sources: structuredClone(params.source.sources),
    claims: [],
    findings: [],
    attempts: [],
    gaps: [],
    createdAt: now,
    updatedAt: now,
    repairPasses: 0,
    localModelCalls: 0,
    remoteModelCalls: 0,
    stageStartedAt: now,
    stageTimingsMs: {},
  };
}

import { createHash } from "node:crypto";
import type {
  ResearchModelAttempt,
  ResearchPlan,
  ResearchPlanProvenance,
  ResearchRunReport,
} from "./types.js";

export function researchPlanSha256(plan: ResearchPlan): string {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

export function createPlanProvenance(params: {
  plan: ResearchPlan;
  attempt: ResearchModelAttempt | undefined;
  sourceRunId?: string;
}): ResearchPlanProvenance | undefined {
  const { attempt } = params;
  if (!attempt || attempt.role !== "planner" || attempt.status !== "succeeded") {
    return undefined;
  }
  return {
    modelId: attempt.modelId,
    provider: attempt.provider,
    model: attempt.model,
    generatedAt: attempt.endedAt,
    planSha256: researchPlanSha256(params.plan),
    ...(params.sourceRunId ? { sourceRunId: params.sourceRunId } : {}),
  };
}

export function resolvePlanProvenance(
  report: ResearchRunReport,
): ResearchPlanProvenance | undefined {
  if (!report.plan) {
    return undefined;
  }
  const planSha256 = researchPlanSha256(report.plan);
  if (report.planProvenance?.planSha256 === planSha256) {
    return {
      ...structuredClone(report.planProvenance),
      sourceRunId: report.planProvenance.sourceRunId ?? report.runId,
    };
  }
  const plannerAttempt = report.attempts.findLast(
    (attempt) => attempt.role === "planner" && attempt.status === "succeeded",
  );
  return createPlanProvenance({
    plan: report.plan,
    attempt: plannerAttempt,
    sourceRunId: report.runId,
  });
}

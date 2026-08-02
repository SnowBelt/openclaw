import { randomUUID } from "node:crypto";
import type { OpenClawPluginApi, OpenClawPluginToolContext } from "../api.js";
import { certifyResearch, effectiveMinimumDomains } from "./certification.js";
import type { ResolvedResearchManagerConfig } from "./config.js";
import { ResearchFlowController } from "./durability.js";
import { ResearchBlockedError } from "./errors.js";
import { finalizeResearch, type FinalizationResult } from "./finalization.js";
import type { ModelCapabilityRegistry } from "./model-registry.js";
import type { StructuredModelRunner } from "./model-runner.js";
import {
  createPlanProvenance,
  researchPlanSha256,
  resolvePlanProvenance,
} from "./plan-provenance.js";
import { createResearchPlan } from "./planning.js";
import { retrieveResearchSources } from "./retrieval.js";
import { runLocalResearchTeam, verifyResearchClaims } from "./team.js";
import type {
  ResearchFinding,
  ResearchModelAttempt,
  ResearchRunReport,
  ResearchRunMetrics,
  ResearchRunRequest,
  ResearchRunStatus,
} from "./types.js";

export type ResearchPipelineStages = {
  createPlan: typeof createResearchPlan;
  retrieveSources: typeof retrieveResearchSources;
  runTeam: typeof runLocalResearchTeam;
  verifyClaims: typeof verifyResearchClaims;
  finalize: typeof finalizeResearch;
  certify: typeof certifyResearch;
};

type ResearchPipelineRuntime = {
  api: OpenClawPluginApi;
  config: ResolvedResearchManagerConfig;
  runner: StructuredModelRunner;
  registry: ModelCapabilityRegistry;
  store: {
    load(runId: string): Promise<ResearchRunReport | undefined>;
    create(report: ResearchRunReport): Promise<void>;
    save(report: ResearchRunReport): Promise<void>;
    update(
      runId: string,
      mutate: (current: ResearchRunReport) => ResearchRunReport | Promise<ResearchRunReport>,
    ): Promise<ResearchRunReport>;
  };
};

const DEFAULT_STAGES: ResearchPipelineStages = {
  createPlan: createResearchPlan,
  retrieveSources: retrieveResearchSources,
  runTeam: runLocalResearchTeam,
  verifyClaims: verifyResearchClaims,
  finalize: finalizeResearch,
  certify: certifyResearch,
};

class ResearchCancelledError extends Error {
  constructor() {
    super("Research run was cancelled.");
    this.name = "ResearchCancelledError";
  }
}

function newReport(
  request: ResearchRunRequest,
  mode: "certified" | "best-effort",
): ResearchRunReport {
  const now = new Date().toISOString();
  return {
    runId: request.runId ?? randomUUID(),
    query: request.query.trim(),
    mode,
    status: "queued",
    sources: [],
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

function stageIsTerminal(status: ResearchRunStatus): boolean {
  return status === "completed" || status === "cancelled";
}

function addTokenUsage(
  target: ResearchRunMetrics["tokenUsage"]["local"],
  usage: ResearchModelAttempt["tokenUsage"],
): void {
  if (!usage) {
    return;
  }
  target.input += usage.input ?? 0;
  target.output += usage.output ?? 0;
  target.cacheRead += usage.cacheRead ?? 0;
  target.cacheWrite += usage.cacheWrite ?? 0;
  target.total +=
    usage.total ??
    (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
}

function computeRunMetrics(report: ResearchRunReport, completedAt: string): ResearchRunMetrics {
  const local = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  const remote = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  const successfulRemote = report.attempts.filter(
    (attempt) => !attempt.local && attempt.status === "succeeded",
  );
  for (const attempt of report.attempts) {
    addTokenUsage(attempt.local ? local : remote, attempt.tokenUsage);
  }
  const reportedCosts = successfulRemote.flatMap((attempt) =>
    attempt.costUsd === undefined ? [] : [attempt.costUsd],
  );
  const costCoverage =
    successfulRemote.length === 0
      ? "not-applicable"
      : reportedCosts.length === 0
        ? "unavailable"
        : reportedCosts.length === successfulRemote.length
          ? "complete"
          : "partial";
  const totalCalls = report.localModelCalls + report.remoteModelCalls;
  return {
    wallTimeMs: Math.max(0, Date.parse(completedAt) - Date.parse(report.createdAt)),
    localCallShare: totalCalls === 0 ? 0 : report.localModelCalls / totalCalls,
    fallbackCount: report.attempts.filter((attempt) => Boolean(attempt.fallbackReason)).length,
    tokenUsage: { local, remote },
    costCoverage,
    ...(reportedCosts.length > 0
      ? { reportedCostUsd: reportedCosts.reduce((sum, value) => sum + value, 0) }
      : {}),
  };
}

export async function runResearchPipeline(params: {
  runtime: ResearchPipelineRuntime;
  request: ResearchRunRequest;
  ctx?: OpenClawPluginToolContext;
  stages?: ResearchPipelineStages;
  signal?: AbortSignal;
}): Promise<ResearchRunReport> {
  const stages = params.stages ?? DEFAULT_STAGES;
  const mode = params.request.mode ?? params.runtime.config.defaultMode;
  const existing = params.request.runId
    ? await params.runtime.store.load(params.request.runId)
    : undefined;
  let report: ResearchRunReport;
  if (existing) {
    report = {
      ...existing,
      status: stageIsTerminal(existing.status) ? existing.status : "queued",
    };
    delete report.blockedReason;
    delete report.failure;
    if (!stageIsTerminal(existing.status)) {
      delete report.completedAt;
    }
  } else {
    report = newReport(params.request, mode);
  }
  if (!report.planProvenance && report.replayedFromRunId) {
    const source = await params.runtime.store.load(report.replayedFromRunId);
    const inherited = source ? resolvePlanProvenance(source) : undefined;
    if (inherited && report.plan && inherited.planSha256 === researchPlanSha256(report.plan)) {
      report.planProvenance = inherited;
    }
  }
  if (!report.query) {
    throw new Error("Research query is required.");
  }
  params.runtime.runner.restoreCooldowns?.(report.attempts);
  if (existing?.status === "completed") {
    return existing;
  }
  if (existing) {
    if (existing.status === "cancelled") {
      return existing;
    }
    await params.runtime.store.save(report);
  } else {
    await params.runtime.store.create(report);
  }
  const flow = params.ctx
    ? ResearchFlowController.create({ api: params.runtime.api, ctx: params.ctx, report })
    : undefined;

  const persist = async (
    status: ResearchRunStatus,
    patch: Partial<ResearchRunReport> = {},
  ): Promise<void> => {
    report = await params.runtime.store.update(report.runId, (current) => {
      if (current.status === "cancelled" && status !== "cancelled") {
        return current;
      }
      const now = new Date().toISOString();
      const transitioning = current.status !== status;
      const stageTimingsMs = { ...current.stageTimingsMs };
      if (transitioning && current.stageStartedAt) {
        stageTimingsMs[current.status] =
          (stageTimingsMs[current.status] ?? 0) +
          Math.max(0, Date.parse(now) - Date.parse(current.stageStartedAt));
      }
      const next = {
        ...current,
        ...patch,
        status,
        stageTimingsMs,
        ...(transitioning ? { stageStartedAt: now } : {}),
      };
      if (["completed", "blocked", "failed", "cancelled"].includes(status)) {
        next.metrics = computeRunMetrics(next, next.completedAt ?? now);
        delete next.stageStartedAt;
      }
      return next;
    });
    flow?.update(report.status, report);
  };
  const ensureActive = async (): Promise<void> => {
    if (params.signal?.aborted) {
      throw new ResearchCancelledError();
    }
    const current = await params.runtime.store.load(report.runId);
    if (current?.status === "cancelled") {
      report = current;
      throw new ResearchCancelledError();
    }
  };
  const recordAttempt = async (attempt: ResearchModelAttempt): Promise<void> => {
    const succeeded = attempt.status === "succeeded";
    report = await params.runtime.store.update(report.runId, (current) => ({
      ...current,
      attempts: [...current.attempts, attempt],
      localModelCalls: current.localModelCalls + Number(succeeded && attempt.local),
      remoteModelCalls: current.remoteModelCalls + Number(succeeded && !attempt.local),
    }));
  };
  const checkpointResearchFinding = async (finding: ResearchFinding): Promise<void> => {
    report = await params.runtime.store.update(report.runId, (current) => ({
      ...current,
      researchUnitFindings: [
        ...(current.researchUnitFindings ?? []).filter(
          (storedFinding) => storedFinding.workerId !== finding.workerId,
        ),
        finding,
      ],
    }));
  };

  try {
    await ensureActive();
    if (!report.plan) {
      await persist("planning");
      const planned = await stages.createPlan({
        runner: params.runtime.runner,
        config: params.runtime.config,
        request: params.request,
        mode,
        signal: params.signal,
        onAttempt: recordAttempt,
      });
      const provenance = createPlanProvenance({
        plan: planned.plan,
        attempt:
          planned.attempts.findLast(
            (attempt) => attempt.role === "planner" && attempt.status === "succeeded",
          ) ??
          report.attempts.findLast(
            (attempt) => attempt.role === "planner" && attempt.status === "succeeded",
          ),
      });
      await persist("retrieving", {
        plan: planned.plan,
        ...(provenance ? { planProvenance: provenance } : {}),
      });
    }

    await ensureActive();
    if (report.sources.length === 0) {
      await persist("retrieving");
      const retrieval = await stages.retrieveSources({
        api: params.runtime.api,
        config: params.runtime.config,
        runner: params.runtime.runner,
        mode,
        plan: report.plan as NonNullable<ResearchRunReport["plan"]>,
        maxSources: params.request.maxSources,
        deadlineMs: params.request.deadlineMs,
        signal: params.signal,
        onAttempt: recordAttempt,
      });
      if (retrieval.sources.length === 0) {
        await persist("retrieving", {
          gaps: [...report.gaps, ...retrieval.gaps],
        });
        throw new ResearchBlockedError(
          "retrieval_unavailable",
          "No research sources could be retrieved.",
        );
      }
      await persist("researching", {
        sources: retrieval.sources,
        gaps: [...report.gaps, ...retrieval.gaps],
      });
    }

    await ensureActive();
    if (report.findings.length === 0) {
      await persist("researching");
      const team = await stages.runTeam({
        runner: params.runtime.runner,
        config: params.runtime.config,
        mode,
        query: report.query,
        plan: report.plan as NonNullable<ResearchRunReport["plan"]>,
        sources: report.sources,
        deadlineMs: params.request.deadlineMs,
        signal: params.signal,
        onAttempt: recordAttempt,
        existingFindings: report.researchUnitFindings,
        onFinding: checkpointResearchFinding,
      });
      await persist("verifying", { findings: team.findings, claims: team.claims });
    }

    await ensureActive();
    if (report.claims.some((claim) => claim.status === "proposed")) {
      await persist("verifying");
      const verification = await stages.verifyClaims({
        runner: params.runtime.runner,
        config: params.runtime.config,
        mode,
        plan: report.plan as NonNullable<ResearchRunReport["plan"]>,
        claims: report.claims,
        sources: report.sources,
        deadlineMs: params.request.deadlineMs,
        signal: params.signal,
        onAttempt: recordAttempt,
      });
      await persist("finalizing", {
        claims: verification.claims,
        gaps: [...report.gaps, ...verification.gaps],
      });
    }

    await ensureActive();
    let finalization: FinalizationResult;
    if (!report.answer || !report.usedClaimIds) {
      await persist("finalizing");
      finalization = await stages.finalize({
        runner: params.runtime.runner,
        config: params.runtime.config,
        mode,
        query: report.query,
        plan: report.plan as NonNullable<ResearchRunReport["plan"]>,
        claims: report.claims,
        sources: report.sources,
        deadlineMs: params.request.deadlineMs,
        signal: params.signal,
        onAttempt: recordAttempt,
      });
      await persist("certifying", {
        answer: finalization.answer,
        usedClaimIds: finalization.usedClaimIds,
        limitations: finalization.limitations,
        gaps: [...report.gaps, ...finalization.limitations],
      });
    } else {
      finalization = {
        answer: report.answer,
        usedClaimIds: report.usedClaimIds ?? [],
        limitations: report.limitations ?? report.gaps,
        attempts: [],
      };
    }

    await ensureActive();
    await persist("certifying");
    let judged = await stages.certify({
      runner: params.runtime.runner,
      config: params.runtime.config,
      registry: params.runtime.registry,
      report,
      finalization,
      deadlineMs: params.request.deadlineMs,
      signal: params.signal,
      onAttempt: recordAttempt,
    });
    let best = { finalization, certification: judged.certification };
    const sourceById = new Map(report.sources.map((source) => [source.id, source]));
    const fetchedSourceIds = new Set(
      report.sources
        .filter((source) => source.fetchStatus === "fetched")
        .map((source) => source.id),
    );
    const availableSupportingSourceIds = new Set(
      report.claims.flatMap((claim) =>
        claim.status === "verified"
          ? claim.evidence
              .filter((entry) => entry.supports && fetchedSourceIds.has(entry.sourceId))
              .map((entry) => entry.sourceId)
          : [],
      ),
    );
    const availableSupportingDomains = new Set(
      [...availableSupportingSourceIds].flatMap((sourceId) => {
        const source = sourceById.get(sourceId);
        return source ? [source.domain] : [];
      }),
    );
    const requiredDomains = effectiveMinimumDomains(
      report.plan,
      params.runtime.config.certification.minDomains,
    );
    const availableVerifiedQuestionIds = new Set(
      report.claims
        .filter(
          (claim) => claim.status === "verified" && claim.evidence.some((entry) => entry.supports),
        )
        .map((claim) => claim.questionId),
    );
    const unrepairableHardFailure = (failure: string): boolean => {
      if (/frontier (planner|finalizer)/i.test(failure)) {
        return true;
      }
      if (
        /source count/i.test(failure) &&
        availableSupportingSourceIds.size < params.runtime.config.certification.minSources
      ) {
        return true;
      }
      if (/domain count/i.test(failure) && availableSupportingDomains.size < requiredDomains) {
        return true;
      }
      const requiredCoverage = /required question coverage is incomplete:\s*([^.]+)\./i.exec(
        failure,
      );
      const missingQuestionIds =
        requiredCoverage?.[1]
          ?.split(",")
          .map((value) => value.trim())
          .filter(Boolean) ?? [];
      return missingQuestionIds.some((questionId) => !availableVerifiedQuestionIds.has(questionId));
    };

    if (mode === "certified") {
      while (
        !best.certification.certified &&
        report.repairPasses < params.runtime.config.certification.maxRepairPasses &&
        !best.certification.hardGateFailures.some(unrepairableHardFailure)
      ) {
        await persist("finalizing", { repairPasses: report.repairPasses + 1 });
        const repairFeedback = [
          ...best.certification.hardGateFailures,
          ...best.certification.dimensions
            .filter((dimension) => dimension.score < params.runtime.config.certificationThreshold)
            .map(
              (dimension) =>
                `${dimension.id} scored ${dimension.score}/100: ${dimension.notes.join(" ")}`,
            ),
        ];
        const candidate = await stages.finalize({
          runner: params.runtime.runner,
          config: params.runtime.config,
          mode,
          query: report.query,
          plan: report.plan as NonNullable<ResearchRunReport["plan"]>,
          claims: report.claims,
          sources: report.sources,
          priorAnswer: best.finalization.answer,
          repairFailures: repairFeedback,
          deadlineMs: params.request.deadlineMs,
          signal: params.signal,
          onAttempt: recordAttempt,
        });
        await persist("certifying", {
          answer: candidate.answer,
          usedClaimIds: candidate.usedClaimIds,
          limitations: candidate.limitations,
        });
        judged = await stages.certify({
          runner: params.runtime.runner,
          config: params.runtime.config,
          registry: params.runtime.registry,
          report,
          finalization: candidate,
          deadlineMs: params.request.deadlineMs,
          signal: params.signal,
          onAttempt: recordAttempt,
        });
        if (
          judged.certification.score > best.certification.score ||
          (judged.certification.score === best.certification.score &&
            judged.certification.hardGateFailures.length <
              best.certification.hardGateFailures.length)
        ) {
          best = { finalization: candidate, certification: judged.certification };
        }
      }
    }

    const completedAt = new Date().toISOString();
    if (mode === "certified" && !best.certification.certified) {
      const failureDetails =
        best.certification.hardGateFailures.length > 0
          ? best.certification.hardGateFailures
          : best.certification.dimensions
              .filter((dimension) => dimension.score < best.certification.threshold)
              .map((dimension) => `${dimension.id}=${dimension.score}`);
      const reason = `Certification failed at ${best.certification.score}/${best.certification.threshold}: ${failureDetails.join("; ")}`;
      await persist("blocked", {
        answer: best.finalization.answer,
        usedClaimIds: best.finalization.usedClaimIds,
        limitations: best.finalization.limitations,
        certification: best.certification,
        blockedReason: reason,
        completedAt,
      });
      flow?.wait(report, reason);
      return report;
    }
    await persist("completed", {
      answer: best.finalization.answer,
      usedClaimIds: best.finalization.usedClaimIds,
      limitations: best.finalization.limitations,
      certification: best.certification,
      completedAt,
    });
    flow?.finish(report);
    return report;
  } catch (error) {
    if (error instanceof ResearchCancelledError || params.signal?.aborted) {
      const current = await params.runtime.store.load(report.runId);
      if (current?.status === "cancelled") {
        report = current;
      } else {
        await persist("cancelled", { completedAt: new Date().toISOString() });
      }
      await flow?.cancel();
      return report;
    }
    const reason = error instanceof Error ? error.message : String(error);
    if (error instanceof ResearchBlockedError) {
      await persist("blocked", {
        blockedReason: reason,
        gaps: [...report.gaps, reason],
        completedAt: new Date().toISOString(),
      });
      flow?.wait(report, reason);
      return report;
    }
    await persist("failed", {
      failure: reason,
      completedAt: new Date().toISOString(),
    });
    flow?.fail(report, reason);
    return report;
  }
}

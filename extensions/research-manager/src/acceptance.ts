import { createHash, randomUUID } from "node:crypto";
import type { OpenClawPluginToolContext } from "../api.js";
import acceptanceCorpusJson from "../eval/acceptance-corpus.v1.json" with { type: "json" };
import type { ResolvedResearchManagerConfig } from "./config.js";
import { isSolModel } from "./model-registry.js";
import { createResearchReplaySeed } from "./replay.js";
import type { ResearchRunReport, ResearchRunRequest, ResearchRunStatus } from "./types.js";

const ACCEPTANCE_CATEGORIES = new Set<AcceptanceTask["category"]>([
  "factual",
  "comparative",
  "current",
  "adversarial",
  "ambiguous",
  "high-stakes",
]);
const NON_RESUMABLE_RUN_STATUSES = new Set<ResearchRunStatus>(["completed", "cancelled"]);
const MINIMUM_LOCAL_CALL_SHARE = 0.5;

export type AcceptanceProfile = "sol-only" | "hybrid";

export type AcceptanceTask = {
  id: string;
  category: "factual" | "comparative" | "current" | "adversarial" | "ambiguous" | "high-stakes";
  query: string;
  highStakes: boolean;
  minimumScore: number;
  maxSources: number;
  requiredDomainGroups: string[][];
};

export type AcceptanceCorpus = {
  schemaVersion: 1;
  version: string;
  sha256: string;
  tasks: AcceptanceTask[];
};

export type AcceptanceProfileResult = {
  profile: AcceptanceProfile;
  runId: string;
  status: ResearchRunStatus | "error";
  score: number;
  certified: boolean;
  passed: boolean;
  requiredDomainsSatisfied: boolean;
  missingDomainGroups: string[][];
  localModelCalls: number;
  remoteModelCalls: number;
  localCallShare: number;
  remoteTokenTotal: number;
  remoteTokenUsageMeasured: boolean;
  sharedSetupModelCalls: number;
  sharedSetupRemoteTokens: number;
  wallTimeMs: number;
  answerSha256?: string;
  evidenceSha256: string;
  hardGateFailures: string[];
  error?: string;
  completedAt: string;
};

export type AcceptanceCaseReceipt = {
  taskId: string;
  category: AcceptanceTask["category"];
  query: string;
  querySha256: string;
  minimumScore: number;
  requiredDomainGroups: string[][];
  baseline?: AcceptanceProfileResult;
  hybrid?: AcceptanceProfileResult;
  nonInferior?: boolean;
  evidenceMatched?: boolean;
  passed?: boolean;
};

export type AcceptanceGate = {
  id:
    | "corpus-complete"
    | "baseline-certified"
    | "hybrid-certified"
    | "paired-evidence"
    | "paired-non-inferiority"
    | "hybrid-local-share"
    | "remote-token-measured"
    | "remote-token-reduction"
    | "zero-profile-failures";
  passed: boolean;
  actual: number | boolean;
  required: number | boolean | string;
};

export type AcceptanceAggregate = {
  baselineMeanScore: number;
  hybridMeanScore: number;
  qualityDelta: number;
  hybridLocalCallShare: number;
  baselineRemoteTokens: number;
  hybridRemoteTokens: number;
  remoteTokenReduction: number;
  profileFailureRate: number;
};

export type AcceptanceBenchmarkReceipt = {
  schemaVersion: 1;
  receiptId: string;
  status: "running" | "passed" | "failed" | "cancelled";
  corpusVersion: string;
  corpusSha256: string;
  corpusTaskCount: number;
  selectedTaskIds: string[];
  thresholds: {
    minimumScore: 93;
    nonInferiorityMargin: 0;
    minimumLocalCallShare: number;
  };
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  cases: AcceptanceCaseReceipt[];
  aggregate?: AcceptanceAggregate;
  gates?: AcceptanceGate[];
  receiptSha256: string;
};

type AcceptanceRuntime = {
  run(
    request: ResearchRunRequest,
    ctx?: OpenClawPluginToolContext,
    signal?: AbortSignal,
  ): Promise<ResearchRunReport>;
  store: {
    load(runId: string): Promise<ResearchRunReport | undefined>;
    create(report: ResearchRunReport): Promise<void>;
    loadAcceptance(receiptId: string): Promise<AcceptanceBenchmarkReceipt | undefined>;
    saveAcceptance(receipt: AcceptanceBenchmarkReceipt): Promise<void>;
  };
};

type AcceptanceExecution = (params: {
  profile: AcceptanceProfile;
  task: AcceptanceTask;
  runId: string;
  runtime: AcceptanceRuntime;
  sourceReport?: ResearchRunReport;
  signal?: AbortSignal;
}) => Promise<ResearchRunReport>;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function round(value: number, digits = 4): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function mean(values: number[]): number {
  return values.length === 0
    ? 0
    : round(values.reduce((sum, value) => sum + value, 0) / values.length, 2);
}

function parseDomainGroups(value: unknown): string[][] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const groups = value.map((group) =>
    Array.isArray(group)
      ? group
          .filter(
            (domain): domain is string => typeof domain === "string" && Boolean(domain.trim()),
          )
          .map((domain) => domain.trim().toLowerCase())
      : [],
  );
  return groups.every((group) => group.length > 0) ? groups : undefined;
}

function parseCorpus(raw: string): AcceptanceCorpus {
  const parsed = asRecord(JSON.parse(raw));
  if (
    parsed?.schemaVersion !== 1 ||
    typeof parsed.version !== "string" ||
    !Array.isArray(parsed.tasks)
  ) {
    throw new Error("Research Manager acceptance corpus is invalid.");
  }
  const tasks = parsed.tasks.map((entry): AcceptanceTask => {
    const task = asRecord(entry);
    const groups = parseDomainGroups(task?.requiredDomainGroups);
    if (
      !task ||
      typeof task.id !== "string" ||
      !task.id.trim() ||
      !ACCEPTANCE_CATEGORIES.has(task.category as AcceptanceTask["category"]) ||
      typeof task.query !== "string" ||
      !task.query.trim() ||
      typeof task.highStakes !== "boolean" ||
      typeof task.minimumScore !== "number" ||
      task.minimumScore < 93 ||
      task.minimumScore > 100 ||
      typeof task.maxSources !== "number" ||
      task.maxSources < 1 ||
      task.maxSources > 100 ||
      !groups
    ) {
      throw new Error("Research Manager acceptance corpus contains an invalid task.");
    }
    return {
      id: task.id.trim(),
      category: task.category as AcceptanceTask["category"],
      query: task.query.trim(),
      highStakes: task.highStakes,
      minimumScore: task.minimumScore,
      maxSources: Math.floor(task.maxSources),
      requiredDomainGroups: groups,
    };
  });
  if (new Set(tasks.map((task) => task.id)).size !== tasks.length) {
    throw new Error("Research Manager acceptance corpus contains duplicate task IDs.");
  }
  if (new Set(tasks.map((task) => task.category)).size !== ACCEPTANCE_CATEGORIES.size) {
    throw new Error("Research Manager acceptance corpus does not cover every required category.");
  }
  return {
    schemaVersion: 1,
    version: parsed.version,
    sha256: sha256(raw),
    tasks,
  };
}

export async function loadAcceptanceCorpus(): Promise<AcceptanceCorpus> {
  return parseCorpus(JSON.stringify(acceptanceCorpusJson));
}

export function createSolOnlyConfig(
  config: ResolvedResearchManagerConfig,
): ResolvedResearchManagerConfig {
  const models = config.models
    .filter((model) => model.enabled && isSolModel(model))
    .map((model) =>
      Object.assign({}, model, { roles: [...model.roles], thinking: "max" as const }),
    );
  const coveredRoles = new Set(models.flatMap((model) => model.roles));
  const missingRoles = ["planner", "scout", "researcher", "verifier", "critic", "finalizer"].filter(
    (role) => !coveredRoles.has(role as never),
  );
  if (models.length === 0 || missingRoles.length > 0) {
    throw new Error(
      `Sol-only acceptance requires configured Sol coverage for every role; missing: ${missingRoles.join(", ") || "all"}.`,
    );
  }
  return {
    ...config,
    defaultMode: "certified",
    models,
    resourceLimits: { ...config.resourceLimits },
    retrieval: { ...config.retrieval },
    certification: { ...config.certification },
  };
}

function domainMatches(domain: string, required: string): boolean {
  const normalized = domain.toLowerCase().replace(/^www\./, "");
  return normalized === required || normalized.endsWith(`.${required}`);
}

function evidenceHash(report: ResearchRunReport): string {
  return sha256(
    JSON.stringify(
      report.sources
        .map((source) => ({
          url: source.finalUrl ?? source.url,
          contentSha256: source.contentSha256 ?? null,
          fetchStatus: source.fetchStatus,
        }))
        .toSorted((left, right) => left.url.localeCompare(right.url)),
    ),
  );
}

function attemptTokenTotal(attempt: ResearchRunReport["attempts"][number]): number {
  const usage = attempt.tokenUsage;
  return (
    usage?.total ??
    (usage?.input ?? 0) + (usage?.output ?? 0) + (usage?.cacheRead ?? 0) + (usage?.cacheWrite ?? 0)
  );
}

function remoteTokenUsageMeasured(attempts: ResearchRunReport["attempts"]): boolean {
  const successfulRemote = attempts.filter(
    (attempt) => !attempt.local && attempt.status === "succeeded",
  );
  return (
    successfulRemote.length > 0 &&
    successfulRemote.every(
      (attempt) =>
        attempt.tokenUsage !== undefined &&
        Object.values(attempt.tokenUsage).some(
          (value) => typeof value === "number" && Number.isFinite(value),
        ),
    )
  );
}

export function summarizeAcceptanceRun(params: {
  profile: AcceptanceProfile;
  task: AcceptanceTask;
  report: ResearchRunReport;
  sharedSetupReport?: ResearchRunReport;
}): AcceptanceProfileResult {
  const claimById = new Map(params.report.claims.map((claim) => [claim.id, claim]));
  const usedSourceIds = new Set(
    (params.report.usedClaimIds ?? []).flatMap((claimId) => {
      const claim = claimById.get(claimId);
      return claim?.status === "verified"
        ? claim.evidence.filter((entry) => entry.supports).map((entry) => entry.sourceId)
        : [];
    }),
  );
  const domains = new Set(
    params.report.sources
      .filter((source) => source.fetchStatus === "fetched" && usedSourceIds.has(source.id))
      .map((source) => source.domain.toLowerCase()),
  );
  const missingDomainGroups = params.task.requiredDomainGroups.filter(
    (group) =>
      !group.some((required) => [...domains].some((domain) => domainMatches(domain, required))),
  );
  const score = params.report.certification?.score ?? 0;
  const certified = params.report.certification?.certified === true;
  const sharedSetupAttempts =
    params.sharedSetupReport?.attempts.filter(
      (attempt) => attempt.role === "planner" || attempt.role === "scout",
    ) ?? [];
  const effectiveAttempts = [...sharedSetupAttempts, ...params.report.attempts];
  const successfulAttempts = effectiveAttempts.filter((attempt) => attempt.status === "succeeded");
  const localModelCalls = successfulAttempts.filter((attempt) => attempt.local).length;
  const remoteModelCalls = successfulAttempts.length - localModelCalls;
  const totalCalls = localModelCalls + remoteModelCalls;
  const measuredRemoteTokens = effectiveAttempts
    .filter((attempt) => !attempt.local)
    .reduce((sum, attempt) => sum + attemptTokenTotal(attempt), 0);
  const sharedSetupRemoteTokens = sharedSetupAttempts
    .filter((attempt) => !attempt.local)
    .reduce((sum, attempt) => sum + attemptTokenTotal(attempt), 0);
  const sharedSetupWallTimeMs = params.sharedSetupReport
    ? (params.sharedSetupReport.stageTimingsMs?.planning ?? 0) +
      (params.sharedSetupReport.stageTimingsMs?.retrieving ?? 0)
    : 0;
  return {
    profile: params.profile,
    runId: params.report.runId,
    status: params.report.status,
    score,
    certified,
    passed:
      params.report.status === "completed" &&
      certified &&
      score >= params.task.minimumScore &&
      missingDomainGroups.length === 0,
    requiredDomainsSatisfied: missingDomainGroups.length === 0,
    missingDomainGroups,
    localModelCalls,
    remoteModelCalls,
    localCallShare: totalCalls === 0 ? 0 : round(localModelCalls / totalCalls),
    remoteTokenTotal: measuredRemoteTokens,
    remoteTokenUsageMeasured: remoteTokenUsageMeasured(effectiveAttempts),
    sharedSetupModelCalls: sharedSetupAttempts.filter((attempt) => attempt.status === "succeeded")
      .length,
    sharedSetupRemoteTokens,
    wallTimeMs: (params.report.metrics?.wallTimeMs ?? 0) + sharedSetupWallTimeMs,
    ...(params.report.answer ? { answerSha256: sha256(params.report.answer) } : {}),
    evidenceSha256: evidenceHash(params.report),
    hardGateFailures: params.report.certification?.hardGateFailures ?? [],
    ...(params.report.failure || params.report.blockedReason
      ? { error: params.report.failure ?? params.report.blockedReason }
      : {}),
    completedAt: params.report.completedAt ?? params.report.updatedAt,
  };
}

function failedProfileResult(
  profile: AcceptanceProfile,
  runId: string,
  error: unknown,
): AcceptanceProfileResult {
  return {
    profile,
    runId,
    status: "error",
    score: 0,
    certified: false,
    passed: false,
    requiredDomainsSatisfied: false,
    missingDomainGroups: [],
    localModelCalls: 0,
    remoteModelCalls: 0,
    localCallShare: 0,
    remoteTokenTotal: 0,
    remoteTokenUsageMeasured: false,
    sharedSetupModelCalls: 0,
    sharedSetupRemoteTokens: 0,
    wallTimeMs: 0,
    evidenceSha256: sha256(""),
    hardGateFailures: [],
    error: error instanceof Error ? error.message : String(error),
    completedAt: new Date().toISOString(),
  };
}

function receiptHash(receipt: Omit<AcceptanceBenchmarkReceipt, "receiptSha256">): string {
  return sha256(JSON.stringify(receipt));
}

function withReceiptHash(
  receipt: Omit<AcceptanceBenchmarkReceipt, "receiptSha256">,
): AcceptanceBenchmarkReceipt {
  return { ...receipt, receiptSha256: receiptHash(receipt) };
}

function updateReceiptHash(receipt: AcceptanceBenchmarkReceipt): AcceptanceBenchmarkReceipt {
  const { receiptSha256: _ignored, ...withoutHash } = receipt;
  return withReceiptHash(withoutHash);
}

export function cancelInterruptedAcceptanceReceipt(
  receipt: AcceptanceBenchmarkReceipt,
  completedAt = new Date().toISOString(),
): AcceptanceBenchmarkReceipt {
  if (receipt.status !== "running") {
    return receipt;
  }
  return updateReceiptHash({
    ...receipt,
    status: "cancelled",
    updatedAt: completedAt,
    completedAt,
  });
}

export function finalizeAcceptanceReceipt(
  receipt: AcceptanceBenchmarkReceipt,
): AcceptanceBenchmarkReceipt {
  const paired = receipt.cases.filter(
    (
      entry,
    ): entry is AcceptanceCaseReceipt & {
      baseline: AcceptanceProfileResult;
      hybrid: AcceptanceProfileResult;
    } => Boolean(entry.baseline && entry.hybrid),
  );
  const baselineMeanScore = mean(paired.map((entry) => entry.baseline.score));
  const hybridMeanScore = mean(paired.map((entry) => entry.hybrid.score));
  const hybridLocalCalls = paired.reduce((sum, entry) => sum + entry.hybrid.localModelCalls, 0);
  const hybridTotalCalls = paired.reduce(
    (sum, entry) => sum + entry.hybrid.localModelCalls + entry.hybrid.remoteModelCalls,
    0,
  );
  const baselineRemoteTokens = paired.reduce(
    (sum, entry) => sum + entry.baseline.remoteTokenTotal,
    0,
  );
  const hybridRemoteTokens = paired.reduce((sum, entry) => sum + entry.hybrid.remoteTokenTotal, 0);
  const profileResults = paired.flatMap((entry) => [entry.baseline, entry.hybrid]);
  const corpusComplete =
    receipt.selectedTaskIds.length === receipt.corpusTaskCount &&
    paired.length === receipt.corpusTaskCount;
  const baselineCertified = paired.length > 0 && paired.every((entry) => entry.baseline.passed);
  const hybridCertified = paired.length > 0 && paired.every((entry) => entry.hybrid.passed);
  const pairedEvidence =
    paired.length > 0 &&
    paired.every((entry) => entry.hybrid.evidenceSha256 === entry.baseline.evidenceSha256);
  const pairedNonInferiority =
    paired.length > 0 && paired.every((entry) => entry.hybrid.score >= entry.baseline.score);
  const hybridLocalCallShare =
    hybridTotalCalls === 0 ? 0 : round(hybridLocalCalls / hybridTotalCalls);
  const tokenMeasurementComplete =
    profileResults.length > 0 && profileResults.every((result) => result.remoteTokenUsageMeasured);
  const remoteTokenReduction =
    baselineRemoteTokens > 0
      ? round((baselineRemoteTokens - hybridRemoteTokens) / baselineRemoteTokens)
      : 0;
  const zeroProfileFailures =
    profileResults.length > 0 &&
    profileResults.every((result) => result.status === "completed" && result.passed);
  const gates: AcceptanceGate[] = [
    {
      id: "corpus-complete",
      passed: corpusComplete,
      actual: paired.length,
      required: receipt.corpusTaskCount,
    },
    {
      id: "baseline-certified",
      passed: baselineCertified,
      actual: baselineCertified,
      required: true,
    },
    {
      id: "hybrid-certified",
      passed: hybridCertified,
      actual: hybridCertified,
      required: true,
    },
    {
      id: "paired-evidence",
      passed: pairedEvidence,
      actual: pairedEvidence,
      required: true,
    },
    {
      id: "paired-non-inferiority",
      passed: pairedNonInferiority,
      actual: round(hybridMeanScore - baselineMeanScore, 2),
      required: ">= 0 per case",
    },
    {
      id: "hybrid-local-share",
      passed: hybridLocalCallShare >= receipt.thresholds.minimumLocalCallShare,
      actual: hybridLocalCallShare,
      required: receipt.thresholds.minimumLocalCallShare,
    },
    {
      id: "remote-token-measured",
      passed: tokenMeasurementComplete,
      actual: tokenMeasurementComplete,
      required: true,
    },
    {
      id: "remote-token-reduction",
      passed: tokenMeasurementComplete && remoteTokenReduction > 0,
      actual: remoteTokenReduction,
      required: "> 0",
    },
    {
      id: "zero-profile-failures",
      passed: zeroProfileFailures,
      actual: zeroProfileFailures,
      required: true,
    },
  ];
  const completedAt = new Date().toISOString();
  const cases = receipt.cases.map((entry) => ({
    ...entry,
    ...(entry.baseline && entry.hybrid
      ? {
          nonInferior: entry.hybrid.score >= entry.baseline.score,
          evidenceMatched: entry.hybrid.evidenceSha256 === entry.baseline.evidenceSha256,
          passed:
            entry.baseline.passed &&
            entry.hybrid.passed &&
            entry.hybrid.evidenceSha256 === entry.baseline.evidenceSha256 &&
            entry.hybrid.score >= entry.baseline.score,
        }
      : { nonInferior: false, evidenceMatched: false, passed: false }),
  }));
  return updateReceiptHash({
    ...receipt,
    status: gates.every((gate) => gate.passed) ? "passed" : "failed",
    updatedAt: completedAt,
    completedAt,
    cases,
    aggregate: {
      baselineMeanScore,
      hybridMeanScore,
      qualityDelta: round(hybridMeanScore - baselineMeanScore, 2),
      hybridLocalCallShare,
      baselineRemoteTokens,
      hybridRemoteTokens,
      remoteTokenReduction,
      profileFailureRate:
        profileResults.length === 0
          ? 1
          : round(profileResults.filter((result) => !result.passed).length / profileResults.length),
    },
    gates,
  });
}

export function acceptanceProfileRunId(
  receiptId: string,
  taskId: string,
  profile: AcceptanceProfile,
): string {
  return `accept-${sha256(`${receiptId}:${taskId}:${profile}`).slice(0, 24)}`;
}

async function defaultExecute(params: {
  profile: AcceptanceProfile;
  task: AcceptanceTask;
  runId: string;
  runtime: AcceptanceRuntime;
  sourceReport?: ResearchRunReport;
  signal?: AbortSignal;
}): Promise<ResearchRunReport> {
  const existing = await params.runtime.store.load(params.runId);
  if (existing && NON_RESUMABLE_RUN_STATUSES.has(existing.status)) {
    return existing;
  }
  if (!existing && params.profile === "hybrid") {
    if (!params.sourceReport) {
      throw new Error("Hybrid acceptance requires its paired Sol-only plan and source corpus.");
    }
    await params.runtime.store.create(
      createResearchReplaySeed({ source: params.sourceReport, runId: params.runId }),
    );
  }
  return await params.runtime.run(
    {
      runId: params.runId,
      query: params.task.query,
      mode: "certified",
      highStakes: params.task.highStakes,
      maxSources: params.task.maxSources,
    },
    undefined,
    params.signal,
  );
}

export async function runAcceptanceBenchmark(params: {
  hybridRuntime: AcceptanceRuntime;
  solOnlyRuntime: AcceptanceRuntime;
  taskIds?: string[];
  receiptId?: string;
  signal?: AbortSignal;
  execute?: AcceptanceExecution;
  onProgress?: (receipt: AcceptanceBenchmarkReceipt) => void | Promise<void>;
}): Promise<AcceptanceBenchmarkReceipt> {
  const corpus = await loadAcceptanceCorpus();
  const existingReceipt = params.receiptId
    ? await params.hybridRuntime.store.loadAcceptance(params.receiptId)
    : undefined;
  if (params.receiptId && !existingReceipt) {
    throw new Error(`Acceptance receipt ${params.receiptId} was not found.`);
  }
  const requestedIds = params.taskIds?.length
    ? [...new Set(params.taskIds.map((id) => id.trim()).filter(Boolean))]
    : (existingReceipt?.selectedTaskIds ?? corpus.tasks.map((task) => task.id));
  const unknownId = requestedIds.find((id) => !corpus.tasks.some((task) => task.id === id));
  if (unknownId) {
    throw new Error(`Unknown Research Manager acceptance task ${unknownId}.`);
  }
  const selectedTasks = corpus.tasks.filter((task) => requestedIds.includes(task.id));
  let receipt = existingReceipt;
  if (receipt) {
    if (
      receipt.corpusSha256 !== corpus.sha256 ||
      JSON.stringify(receipt.selectedTaskIds) !==
        JSON.stringify(selectedTasks.map((task) => task.id))
    ) {
      throw new Error("Acceptance receipt does not match the current locked corpus selection.");
    }
    if (receipt.status !== "running" && receipt.status !== "cancelled") {
      return receipt;
    }
    receipt = updateReceiptHash({ ...receipt, status: "running", completedAt: undefined });
  } else {
    const now = new Date().toISOString();
    const initial: Omit<AcceptanceBenchmarkReceipt, "receiptSha256"> = {
      schemaVersion: 1,
      receiptId: randomUUID(),
      status: "running",
      corpusVersion: corpus.version,
      corpusSha256: corpus.sha256,
      corpusTaskCount: corpus.tasks.length,
      selectedTaskIds: selectedTasks.map((task) => task.id),
      thresholds: {
        minimumScore: 93,
        nonInferiorityMargin: 0,
        minimumLocalCallShare: MINIMUM_LOCAL_CALL_SHARE,
      },
      startedAt: now,
      updatedAt: now,
      cases: selectedTasks.map((task) => ({
        taskId: task.id,
        category: task.category,
        query: task.query,
        querySha256: sha256(task.query),
        minimumScore: task.minimumScore,
        requiredDomainGroups: task.requiredDomainGroups,
      })),
    };
    receipt = withReceiptHash(initial);
  }

  const save = async (): Promise<void> => {
    receipt = updateReceiptHash({
      ...(receipt as AcceptanceBenchmarkReceipt),
      updatedAt: new Date().toISOString(),
    });
    await params.hybridRuntime.store.saveAcceptance(receipt);
    await params.onProgress?.(receipt);
  };
  await save();
  const cancel = async (): Promise<AcceptanceBenchmarkReceipt> => {
    receipt = cancelInterruptedAcceptanceReceipt(receipt as AcceptanceBenchmarkReceipt);
    await params.hybridRuntime.store.saveAcceptance(receipt);
    await params.onProgress?.(receipt);
    return receipt;
  };
  const execute = params.execute ?? defaultExecute;
  for (const task of selectedTasks) {
    if (params.signal?.aborted) {
      return await cancel();
    }
    const index = receipt.cases.findIndex((entry) => entry.taskId === task.id);
    const current = receipt.cases[index];
    if (!current) {
      throw new Error(`Acceptance receipt is missing task ${task.id}.`);
    }
    let baselineReport: ResearchRunReport | undefined;
    if (!current.baseline) {
      const runId = acceptanceProfileRunId(receipt.receiptId, task.id, "sol-only");
      let baseline: AcceptanceProfileResult;
      try {
        baselineReport = await execute({
          profile: "sol-only",
          task,
          runId,
          runtime: params.solOnlyRuntime,
          signal: params.signal,
        });
        baseline = summarizeAcceptanceRun({
          profile: "sol-only",
          task,
          report: baselineReport,
        });
      } catch (error) {
        baseline = failedProfileResult("sol-only", runId, error);
      }
      receipt.cases[index] = { ...current, baseline };
      await save();
    } else {
      baselineReport = await params.solOnlyRuntime.store.load(current.baseline.runId);
    }
    if (params.signal?.aborted) {
      return await cancel();
    }
    const afterBaseline = receipt.cases[index];
    if (!afterBaseline?.hybrid) {
      const runId = acceptanceProfileRunId(receipt.receiptId, task.id, "hybrid");
      let hybrid: AcceptanceProfileResult;
      try {
        if (!baselineReport) {
          throw new Error(
            `Paired Sol-only report ${afterBaseline?.baseline?.runId ?? "missing"} is unavailable.`,
          );
        }
        const hybridReport = await execute({
          profile: "hybrid",
          task,
          runId,
          runtime: params.hybridRuntime,
          sourceReport: baselineReport,
          signal: params.signal,
        });
        hybrid = summarizeAcceptanceRun({
          profile: "hybrid",
          task,
          report: hybridReport,
          sharedSetupReport: baselineReport,
        });
      } catch (error) {
        hybrid = failedProfileResult("hybrid", runId, error);
      }
      receipt.cases[index] = { ...afterBaseline, hybrid };
      await save();
    }
  }
  receipt = finalizeAcceptanceReceipt(receipt);
  await params.hybridRuntime.store.saveAcceptance(receipt);
  await params.onProgress?.(receipt);
  return receipt;
}

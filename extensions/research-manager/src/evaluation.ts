import { createHash, randomUUID } from "node:crypto";
import type { JsonSchemaObject } from "openclaw/plugin-sdk/json-schema-runtime";
import evaluationCorpusJson from "../eval/corpus.v1.json" with { type: "json" };
import type { ResolvedResearchManagerConfig } from "./config.js";
import type { ModelCapabilityRegistry } from "./model-registry.js";
import { ROLE_QUALIFICATION_THRESHOLDS } from "./model-registry.js";
import type { StructuredModelRunner } from "./model-runner.js";
import { findOllamaModel, type OllamaInventory } from "./ollama.js";
import {
  CLAIM_VERIFICATION_SCHEMA,
  FINALIZATION_SCHEMA,
  QUALITY_JUDGE_SCHEMA,
  RESEARCH_FINDING_SCHEMA,
  RESEARCH_PLAN_SCHEMA,
  SOURCE_SCOUT_SCHEMA,
} from "./schemas.js";
import type {
  ResearchModelAttempt,
  ResearchModelRole,
  ResearchModelSpec,
  ResearchPlan,
} from "./types.js";

type EvaluationSchemaKind =
  | "plan"
  | "scout"
  | "finding"
  | "verification"
  | "judge"
  | "finalization";

type EvaluationTask = {
  id: string;
  category: "factual" | "comparative" | "current" | "adversarial" | "ambiguous" | "high-stakes";
  role: ResearchModelRole;
  schemaKind: EvaluationSchemaKind;
  prompt: string;
  expected: Record<string, unknown>;
};

const EVALUATION_CATEGORIES = new Set<EvaluationTask["category"]>([
  "factual",
  "comparative",
  "current",
  "adversarial",
  "ambiguous",
  "high-stakes",
]);
const EVALUATION_ROLES = new Set<ResearchModelRole>([
  "planner",
  "scout",
  "researcher",
  "verifier",
  "critic",
  "finalizer",
]);
const EVALUATION_SCHEMA_KINDS = new Set<EvaluationSchemaKind>([
  "plan",
  "scout",
  "finding",
  "verification",
  "judge",
  "finalization",
]);

export type EvaluationCorpus = {
  schemaVersion: 1;
  version: string;
  sha256: string;
  tasks: EvaluationTask[];
};

export type EvaluationCaseResult = {
  taskId: string;
  category: EvaluationTask["category"];
  role: ResearchModelRole;
  score: number;
  schemaValid: boolean;
  durationMs: number;
  attempt?: ResearchModelAttempt;
  notes: string[];
  error?: string;
};

export type RoleEvaluationResult = {
  role: ResearchModelRole;
  score: number;
  threshold: number;
  qualified: boolean;
  taskCount: number;
  schemaAdherence: number;
  crashRate: number;
  latencyMs: { p50: number; p95: number; mean: number };
  cases: EvaluationCaseResult[];
};

export type ModelBakeoffReceipt = {
  schemaVersion: 1;
  receiptId: string;
  corpusVersion: string;
  corpusSha256: string;
  model: ResearchModelSpec;
  backend: string;
  startedAt: string;
  completedAt: string;
  inventory: {
    installed: boolean | "unknown";
    loaded: boolean | "unknown";
    sizeBytes?: number;
    parameterSize?: string;
    quantization?: string;
    contextLength?: number;
  };
  roles: RoleEvaluationResult[];
  overall: {
    score: number;
    schemaAdherence: number;
    crashRate: number;
    casesPerMinute: number;
  };
  qualificationsPersisted: boolean;
  receiptSha256: string;
};

type EvaluationRuntime = {
  config: ResolvedResearchManagerConfig;
  runner: StructuredModelRunner;
  registry: ModelCapabilityRegistry;
  store: {
    saveEvaluation(receipt: ModelBakeoffReceipt): Promise<void>;
    saveQualification(record: {
      modelId: string;
      role: ResearchModelRole;
      score: number;
      qualified: boolean;
      threshold: number;
      taskCount: number;
      schemaAdherence: number;
      crashRate: number;
      latencyMs: { p50: number; p95: number; mean: number };
      corpusVersion: string;
      corpusSha256: string;
      measuredAt: string;
      evidencePath?: string;
    }): Promise<void>;
  };
  scheduler: { inventory: OllamaInventory | undefined };
};

const SCHEMAS: Record<EvaluationSchemaKind, JsonSchemaObject> = {
  plan: RESEARCH_PLAN_SCHEMA,
  scout: SOURCE_SCOUT_SCHEMA,
  finding: RESEARCH_FINDING_SCHEMA,
  verification: CLAIM_VERIFICATION_SCHEMA,
  judge: QUALITY_JUDGE_SCHEMA,
  finalization: FINALIZATION_SCHEMA,
};

const MAX_TOKENS: Record<EvaluationSchemaKind, number> = {
  plan: 4_000,
  scout: 2_000,
  finding: 4_000,
  verification: 3_000,
  judge: 3_000,
  finalization: 4_000,
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function expectedStrings(task: EvaluationTask, key: string): string[] {
  return strings(task.expected[key]);
}

function expectedNumber(task: EvaluationTask, key: string, fallback: number): number {
  const value = task.expected[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function includesAll(haystack: string, needles: string[]): boolean {
  const normalized = haystack.toLowerCase();
  return needles.every((needle) => normalized.includes(needle.toLowerCase()));
}

function exactSet(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item) => right.includes(item));
}

function scoreChecks(checks: Array<{ ok: boolean; note: string; weight: number }>): {
  score: number;
  notes: string[];
} {
  return {
    score:
      Math.round(checks.reduce((sum, check) => sum + (check.ok ? check.weight : 0), 0) * 100) / 100,
    notes: checks.filter((check) => !check.ok).map((check) => check.note),
  };
}

function scorePlan(task: EvaluationTask, raw: unknown) {
  const plan = raw as ResearchPlan;
  const expectedRisk = task.expected.riskLevel;
  const maxFreshnessDays = expectedNumber(task, "maxFreshnessDays", Number.POSITIVE_INFINITY);
  const questionIds = new Set(plan.questions.map((question) => question.id));
  const sourceText = plan.sourceRequirements.join(" ");
  return scoreChecks([
    {
      ok: plan.riskLevel === expectedRisk,
      note: `riskLevel must be ${String(expectedRisk)}`,
      weight: 20,
    },
    {
      ok: plan.questions.length >= expectedNumber(task, "minQuestions", 1),
      note: "question decomposition is incomplete",
      weight: 20,
    },
    {
      ok: plan.queries.length >= expectedNumber(task, "minQueries", 1),
      note: "search query coverage is incomplete",
      weight: 20,
    },
    {
      ok: plan.queries.every(
        (query) =>
          query.questionIds.length > 0 && query.questionIds.every((id) => questionIds.has(id)),
      ),
      note: "queries are not mapped to valid question IDs",
      weight: 20,
    },
    {
      ok:
        includesAll(sourceText, expectedStrings(task, "sourceTerms")) &&
        (Number.isFinite(maxFreshnessDays)
          ? plan.queries.every(
              (query) =>
                typeof query.freshnessDays === "number" &&
                query.freshnessDays >= 0 &&
                query.freshnessDays <= maxFreshnessDays,
            )
          : true),
      note: "source authority or freshness requirements are incomplete",
      weight: 20,
    },
  ]);
}

function scoreScout(task: EvaluationTask, raw: unknown) {
  const value = asRecord(raw) ?? {};
  const ranked = strings(value.rankedSourceIds);
  const rejected = strings(value.rejectedSourceIds);
  const queries = strings(value.queries);
  const risks = strings(value.risks).join(" ");
  const expectedRanked = expectedStrings(task, "rankedIds");
  const expectedRejected = expectedStrings(task, "rejectedIds");
  return scoreChecks([
    {
      ok:
        expectedRanked.length === 0
          ? ranked.length === 0
          : expectedRanked.every((id, index) => ranked[index] === id),
      note: "source authority ranking is incorrect",
      weight: 30,
    },
    {
      ok: expectedRejected.every((id) => rejected.includes(id)),
      note: "unsafe or irrelevant sources were not rejected",
      weight: 25,
    },
    {
      ok: queries.length >= expectedNumber(task, "minQueries", 1),
      note: "insufficient scout queries",
      weight: 25,
    },
    {
      ok: includesAll(risks, expectedStrings(task, "riskTerms")),
      note: "material scout risks were not identified",
      weight: 20,
    },
  ]);
}

function scoreFinding(task: EvaluationTask, raw: unknown) {
  const value = asRecord(raw) ?? {};
  const claims = Array.isArray(value.claims) ? value.claims.map(asRecord).filter(Boolean) : [];
  const sourceIds = claims.flatMap((claim) => strings(claim?.sourceIds));
  const sourceIdSet = new Set(sourceIds);
  const quotes = claims.flatMap((claim) => {
    const evidence = Array.isArray(claim?.evidence)
      ? claim.evidence.map(asRecord).filter(Boolean)
      : [];
    return evidence.flatMap((entry) => (typeof entry?.quote === "string" ? [entry.quote] : []));
  });
  const serialized = JSON.stringify(raw);
  return scoreChecks([
    {
      ok: expectedStrings(task, "requiredSourceIds").every((id) => sourceIdSet.has(id)),
      note: "required evidence sources are missing",
      weight: 25,
    },
    {
      ok: expectedStrings(task, "requiredQuoteTerms").every((term) =>
        quotes.some((quote) => quote.includes(term)),
      ),
      note: "citation-ready exact quotations are missing",
      weight: 30,
    },
    {
      ok:
        claims.length > 0 &&
        claims.length <= expectedNumber(task, "maxClaims", 8) &&
        claims.every(
          (claim) =>
            strings(claim?.sourceIds).length > 0 &&
            Array.isArray(claim?.evidence) &&
            claim.evidence.some(
              (entry) =>
                typeof asRecord(entry)?.quote === "string" &&
                String(asRecord(entry)?.quote).length >= 12,
            ),
        ),
      note: "claims are excessive, duplicated, or lack source-linked evidence",
      weight: 25,
    },
    {
      ok: !expectedStrings(task, "forbiddenTerms").some((term) =>
        serialized.toLowerCase().includes(term.toLowerCase()),
      ),
      note: "the output followed or repeated adversarial content",
      weight: 20,
    },
  ]);
}

function scoreVerification(task: EvaluationTask, raw: unknown) {
  const value = asRecord(raw) ?? {};
  const results = Array.isArray(value.results) ? value.results.map(asRecord).filter(Boolean) : [];
  const actual = new Map(
    results.flatMap((result) =>
      typeof result?.claimId === "string" && typeof result.status === "string"
        ? [[result.claimId, result.status] as const]
        : [],
    ),
  );
  const actualSupporting = new Map(
    results.flatMap((result) =>
      typeof result?.claimId === "string"
        ? [[result.claimId, strings(result.supportingSourceIds).toSorted()] as const]
        : [],
    ),
  );
  const expected = asRecord(task.expected.statuses) ?? {};
  const entries = Object.entries(expected).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  const correct = entries.filter(([id, status]) => actual.get(id) === status).length;
  const expectedSupporting = asRecord(task.expected.supportingSourceIds) ?? {};
  const supportingEntries = Object.entries(expectedSupporting).flatMap(([claimId, sourceIds]) => {
    const expectedIds = strings(sourceIds).toSorted();
    return [[claimId, expectedIds] as const];
  });
  const supportingCorrect = supportingEntries.filter(
    ([claimId, expectedIds]) =>
      JSON.stringify(actualSupporting.get(claimId) ?? []) === JSON.stringify(expectedIds),
  ).length;
  return scoreChecks([
    {
      ok: correct === entries.length,
      note: `${entries.length - correct} verification label(s) are incorrect`,
      weight: 55,
    },
    {
      ok: supportingCorrect === supportingEntries.length,
      note: `${supportingEntries.length - supportingCorrect} per-source support decision(s) are incorrect`,
      weight: 25,
    },
    {
      ok: results.length === entries.length && actual.size === entries.length,
      note: "verification result coverage or uniqueness is incorrect",
      weight: 10,
    },
    {
      ok: results.every((result) => typeof result?.reason === "string" && result.reason.trim()),
      note: "verification reasons are incomplete",
      weight: 10,
    },
  ]);
}

function scoreJudge(task: EvaluationTask, raw: unknown) {
  const value = asRecord(raw) ?? {};
  const dimensions = Array.isArray(value.dimensions)
    ? value.dimensions.map(asRecord).filter(Boolean)
    : [];
  const byId = new Map(
    dimensions.flatMap((dimension) =>
      typeof dimension?.id === "string" && typeof dimension.score === "number"
        ? [[dimension.id, dimension.score] as const]
        : [],
    ),
  );
  const unsupported = strings(value.materialUnsupportedClaims).join(" ");
  const scoreCeilings: Array<[string, string]> = [
    ["correctness", "maxCorrectness"],
    ["completeness", "maxCompleteness"],
    ["citationEntailment", "maxCitationEntailment"],
    ["calibration", "maxCalibration"],
  ];
  const applicable = scoreCeilings.filter(([, key]) => typeof task.expected[key] === "number");
  return scoreChecks([
    {
      ok: dimensions.length === 7 && byId.size === 7,
      note: "quality judge did not return seven unique rubric dimensions",
      weight: 25,
    },
    {
      ok: includesAll(unsupported, expectedStrings(task, "unsupportedTerms")),
      note: "material unsupported assertions were not identified",
      weight: 30,
    },
    {
      ok: applicable.every(([id, key]) => (byId.get(id) ?? 101) <= expectedNumber(task, key, 100)),
      note: "quality judge was not conservative on weak dimensions",
      weight: 35,
    },
    {
      ok: typeof value.summary === "string" && value.summary.trim().length >= 20,
      note: "quality judge summary is incomplete",
      weight: 10,
    },
  ]);
}

function scoreFinalization(task: EvaluationTask, raw: unknown) {
  const value = asRecord(raw) ?? {};
  const answer = typeof value.answer === "string" ? value.answer : "";
  const usedClaimIds = strings(value.usedClaimIds);
  const limitations = strings(value.limitations);
  const expectedClaims = expectedStrings(task, "usedClaimIds");
  return scoreChecks([
    {
      ok: exactSet(usedClaimIds, expectedClaims),
      note: "final answer selected the wrong claim-ledger entries",
      weight: 25,
    },
    {
      ok: expectedStrings(task, "requiredCitations").every((id) => answer.includes(`[${id}]`)),
      note: "required evidence citations are missing",
      weight: 25,
    },
    {
      ok:
        !expectedStrings(task, "forbiddenCitations").some((id) => answer.includes(`[${id}]`)) &&
        !expectedStrings(task, "forbiddenTerms").some((term) =>
          answer.toLowerCase().includes(term.toLowerCase()),
        ),
      note: "unsupported or disputed content leaked into the answer",
      weight: 25,
    },
    {
      ok:
        /sources/i.test(answer) &&
        (task.expected.requireLimitations !== true || limitations.length > 0),
      note: "source mapping or required limitations are missing",
      weight: 25,
    },
  ]);
}

export function scoreEvaluationTask(task: EvaluationTask, value: unknown) {
  switch (task.schemaKind) {
    case "plan":
      return scorePlan(task, value);
    case "scout":
      return scoreScout(task, value);
    case "finding":
      return scoreFinding(task, value);
    case "verification":
      return scoreVerification(task, value);
    case "judge":
      return scoreJudge(task, value);
    case "finalization":
      return scoreFinalization(task, value);
  }
  const schemaKind: never = task.schemaKind;
  void schemaKind;
  throw new Error("Unsupported evaluation schema kind.");
}

function parseCorpus(raw: string): EvaluationCorpus {
  const parsed = asRecord(JSON.parse(raw));
  if (
    parsed?.schemaVersion !== 1 ||
    typeof parsed.version !== "string" ||
    !Array.isArray(parsed.tasks)
  ) {
    throw new Error("Research Manager evaluation corpus is invalid.");
  }
  const tasks = parsed.tasks.map((entry) => {
    const task = asRecord(entry);
    if (
      !task ||
      typeof task.id !== "string" ||
      !EVALUATION_CATEGORIES.has(task.category as EvaluationTask["category"]) ||
      !EVALUATION_ROLES.has(task.role as ResearchModelRole) ||
      !EVALUATION_SCHEMA_KINDS.has(task.schemaKind as EvaluationSchemaKind) ||
      typeof task.prompt !== "string" ||
      !asRecord(task.expected)
    ) {
      throw new Error("Research Manager evaluation corpus contains an invalid task.");
    }
    return task as unknown as EvaluationTask;
  });
  const ids = new Set(tasks.map((task) => task.id));
  if (ids.size !== tasks.length) {
    throw new Error("Research Manager evaluation corpus contains duplicate task IDs.");
  }
  return {
    schemaVersion: 1,
    version: parsed.version,
    sha256: createHash("sha256").update(raw).digest("hex"),
    tasks,
  };
}

export async function loadEvaluationCorpus(): Promise<EvaluationCorpus> {
  return parseCorpus(JSON.stringify(evaluationCorpusJson));
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) {
    return 0;
  }
  const ordered = values.toSorted((left, right) => left - right);
  const index = Math.min(ordered.length - 1, Math.ceil(percentileValue * ordered.length) - 1);
  return ordered[Math.max(0, index)] ?? 0;
}

function mean(values: number[]): number {
  return values.length === 0
    ? 0
    : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function canonicalReceiptHash(receipt: Omit<ModelBakeoffReceipt, "receiptSha256">): string {
  return createHash("sha256").update(JSON.stringify(receipt)).digest("hex");
}

export async function runModelBakeoff(params: {
  runtime: EvaluationRuntime;
  modelId: string;
  roles?: ResearchModelRole[];
  persistQualifications?: boolean;
}): Promise<ModelBakeoffReceipt> {
  const model = params.runtime.config.models.find((entry) => entry.id === params.modelId);
  if (!model) {
    throw new Error(`Research model ${params.modelId} is not configured.`);
  }
  const requestedRoles = params.roles?.length ? [...new Set(params.roles)] : model.roles;
  const invalidRole = requestedRoles.find((role) => !model.roles.includes(role));
  if (invalidRole) {
    throw new Error(`Research model ${model.id} is not configured for role ${invalidRole}.`);
  }
  const corpus = await loadEvaluationCorpus();
  const startedAt = new Date().toISOString();
  const cases: EvaluationCaseResult[] = [];
  for (const task of corpus.tasks.filter((entry) => requestedRoles.includes(entry.role))) {
    const started = Date.now();
    let attempt: ResearchModelAttempt | undefined;
    try {
      const result = await params.runtime.runner.runModelJson<unknown>({
        model,
        role: task.role,
        prompt: [
          `Evaluation case ${task.id}. This is a locked qualification task.`,
          "Return the minimum complete set of distinct entries. Repetition or semantic duplication fails this case.",
          task.prompt,
        ].join("\n\n"),
        schema: SCHEMAS[task.schemaKind],
        maxTokens: MAX_TOKENS[task.schemaKind],
        temperature: 0,
        priority: "high",
        deadlineMs: params.runtime.config.modelTimeoutMs,
        onAttempt: (value) => {
          attempt = value;
        },
      });
      const scored = scoreEvaluationTask(task, result.value);
      cases.push({
        taskId: task.id,
        category: task.category,
        role: task.role,
        score: scored.score,
        schemaValid: true,
        durationMs: Date.now() - started,
        attempt,
        notes: scored.notes,
      });
    } catch (error) {
      cases.push({
        taskId: task.id,
        category: task.category,
        role: task.role,
        score: 0,
        schemaValid: false,
        durationMs: Date.now() - started,
        attempt,
        notes: ["model call or schema validation failed"],
        error: attempt?.error ?? (error instanceof Error ? error.message : String(error)),
      });
    }
  }
  const roleResults = requestedRoles.map((role): RoleEvaluationResult => {
    const roleCases = cases.filter((entry) => entry.role === role);
    if (roleCases.length < 2) {
      throw new Error(`Evaluation corpus has fewer than two tasks for role ${role}.`);
    }
    const score =
      Math.round(
        (roleCases.reduce((sum, entry) => sum + entry.score, 0) / roleCases.length) * 100,
      ) / 100;
    const schemaAdherence =
      roleCases.filter((entry) => entry.schemaValid).length / roleCases.length;
    const crashRate = roleCases.filter((entry) => !entry.schemaValid).length / roleCases.length;
    const threshold = ROLE_QUALIFICATION_THRESHOLDS[role];
    return {
      role,
      score,
      threshold,
      qualified: score >= threshold && schemaAdherence === 1 && crashRate === 0,
      taskCount: roleCases.length,
      schemaAdherence,
      crashRate,
      latencyMs: {
        p50: percentile(
          roleCases.map((entry) => entry.durationMs),
          0.5,
        ),
        p95: percentile(
          roleCases.map((entry) => entry.durationMs),
          0.95,
        ),
        mean: mean(roleCases.map((entry) => entry.durationMs)),
      },
      cases: roleCases,
    };
  });
  const inventory = params.runtime.scheduler.inventory;
  const installed =
    model.provider === "ollama" && inventory ? findOllamaModel(inventory, model.model) : undefined;
  const completedAt = new Date().toISOString();
  const durationMs = Math.max(1, Date.parse(completedAt) - Date.parse(startedAt));
  const receiptWithoutHash: Omit<ModelBakeoffReceipt, "receiptSha256"> = {
    schemaVersion: 1,
    receiptId: randomUUID(),
    corpusVersion: corpus.version,
    corpusSha256: corpus.sha256,
    model: { ...model, roles: [...model.roles] },
    backend: model.provider,
    startedAt,
    completedAt,
    inventory: {
      installed: model.provider === "ollama" ? Boolean(installed) : "unknown",
      loaded: model.provider === "ollama" ? (installed?.loaded ?? false) : "unknown",
      ...(installed?.sizeBytes ? { sizeBytes: installed.sizeBytes } : {}),
      ...(installed?.parameterSize ? { parameterSize: installed.parameterSize } : {}),
      ...(installed?.quantization ? { quantization: installed.quantization } : {}),
      ...(installed?.contextLength ? { contextLength: installed.contextLength } : {}),
    },
    roles: roleResults,
    overall: {
      score:
        roleResults.length === 0
          ? 0
          : Math.round(
              (roleResults.reduce((sum, entry) => sum + entry.score, 0) / roleResults.length) * 100,
            ) / 100,
      schemaAdherence:
        cases.length === 0 ? 0 : cases.filter((entry) => entry.schemaValid).length / cases.length,
      crashRate:
        cases.length === 0 ? 1 : cases.filter((entry) => !entry.schemaValid).length / cases.length,
      casesPerMinute: Math.round(((cases.length * 60_000) / durationMs) * 100) / 100,
    },
    qualificationsPersisted: params.persistQualifications !== false,
  };
  const receipt: ModelBakeoffReceipt = {
    ...receiptWithoutHash,
    receiptSha256: canonicalReceiptHash(receiptWithoutHash),
  };
  await params.runtime.store.saveEvaluation(receipt);
  if (params.persistQualifications !== false) {
    for (const role of roleResults) {
      await params.runtime.store.saveQualification({
        modelId: model.id,
        role: role.role,
        score: role.score,
        qualified: role.qualified,
        threshold: role.threshold,
        taskCount: role.taskCount,
        schemaAdherence: role.schemaAdherence,
        crashRate: role.crashRate,
        latencyMs: role.latencyMs,
        corpusVersion: corpus.version,
        corpusSha256: corpus.sha256,
        measuredAt: completedAt,
        evidencePath: `state://research-manager-evaluations/${receipt.receiptId}`,
      });
      params.runtime.registry.recordQualification(
        model.id,
        role.role,
        role.qualified ? role.score : 0,
        role.latencyMs,
      );
    }
  }
  return receipt;
}

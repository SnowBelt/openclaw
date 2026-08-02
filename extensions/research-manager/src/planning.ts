import type { ResolvedResearchManagerConfig } from "./config.js";
import { ResearchBlockedError } from "./errors.js";
import { isSolOnlyModelSet } from "./model-registry.js";
import { StructuredModelRunner } from "./model-runner.js";
import { RESEARCH_PLAN_SCHEMA } from "./schemas.js";
import type { ResearchModelAttempt, ResearchPlan, ResearchRunRequest } from "./types.js";

const TIME_SENSITIVE_QUERY_PATTERN =
  /\b(?:as of|current|latest|today|recent|release|releaselog|news|change(?:log|s)?|version|price|rate|schedule|202\d)\b/i;
const OBVIOUS_COMPOUND_QUESTION_PATTERN =
  /[,;][^?]*\b(?:and|or)\b|\b(?:and|or)\s+(?:what|which|how|when|where|why|under)\b|\b(?:including|such as)\b[^?]*(?:,|\band\b|\bor\b)/i;

function normalizeSearchQuery(value: string): string {
  return value
    .replace(/\bsite:([a-z0-9.-]+)\/([^\s]+)/gi, (_match, domain: string, pathPart: string) => {
      const pathTerms = pathPart.replace(/[^a-z0-9._-]+/gi, " ").trim();
      return `site:${domain}${pathTerms ? ` ${pathTerms}` : ""}`;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePlan(
  value: ResearchPlan,
  request: ResearchRunRequest,
  config: ResolvedResearchManagerConfig,
): ResearchPlan {
  const questionIdMap = new Map<string, string>();
  const questions = value.questions.slice(0, 24).map((question, index) => {
    const id = `Q${index + 1}`;
    questionIdMap.set(question.id, id);
    return Object.assign({}, question, {
      id,
      question: question.question.trim(),
    });
  });
  const validQuestionIds = new Set(questions.map((question) => question.id));
  const queries = value.queries
    .slice(0, config.retrieval.queryCount)
    .map((query) => {
      const normalizedQuery = normalizeSearchQuery(query.query);
      const normalized = Object.assign({}, query, {
        query: normalizedQuery,
        questionIds: [
          ...new Set(
            query.questionIds.flatMap((id) => {
              const mapped = questionIdMap.get(id) ?? (validQuestionIds.has(id) ? id : undefined);
              return mapped ? [mapped] : [];
            }),
          ),
        ],
        preferredSourceTypes: [
          ...new Set(query.preferredSourceTypes.map((item) => item.trim())),
        ].filter(Boolean),
      });
      if (
        normalized.freshnessDays !== undefined &&
        !TIME_SENSITIVE_QUERY_PATTERN.test(normalizedQuery)
      ) {
        delete normalized.freshnessDays;
      }
      return normalized;
    })
    .filter((query) => query.query && query.questionIds.length > 0);
  if (queries.length === 0) {
    queries.push({
      query: request.query.trim(),
      questionIds: questions.slice(0, 1).map((question) => question.id),
      preferredSourceTypes: ["authoritative primary sources"],
    });
  }
  const coverageQuestionIds = new Set(
    questions.filter((question) => question.priority !== "optional").map((question) => question.id),
  );
  const mappedQuestionIds = new Set(queries.flatMap((query) => query.questionIds));
  const unmappedQuestionIds = [...coverageQuestionIds].filter(
    (questionId) => !mappedQuestionIds.has(questionId),
  );
  if (queries.length < coverageQuestionIds.size || unmappedQuestionIds.length > 0) {
    throw new ResearchBlockedError(
      "capability_unavailable",
      [
        "Planner did not provide one mapped search query per required or important question.",
        `Questions requiring coverage: ${coverageQuestionIds.size}; retained queries: ${queries.length}.`,
        unmappedQuestionIds.length > 0
          ? `Unmapped questions: ${unmappedQuestionIds.join(", ")}.`
          : "",
      ]
        .filter(Boolean)
        .join(" "),
      {
        coverageQuestionCount: coverageQuestionIds.size,
        retainedQueryCount: queries.length,
        unmappedQuestionIds,
      },
    );
  }
  return {
    objective: value.objective.trim() || request.query.trim(),
    questions,
    queries,
    sourceRequirements: [...new Set(value.sourceRequirements.map((item) => item.trim()))].filter(
      Boolean,
    ),
    riskLevel: request.highStakes ? "high" : value.riskLevel,
    stopConditions: [...new Set(value.stopConditions.map((item) => item.trim()))].filter(Boolean),
  };
}

function obviousCompoundQuestionIds(plan: ResearchPlan): string[] {
  return plan.questions
    .filter(
      (question) =>
        question.priority !== "optional" &&
        OBVIOUS_COMPOUND_QUESTION_PATTERN.test(question.question),
    )
    .map((question) => question.id);
}

export async function createResearchPlan(params: {
  runner: StructuredModelRunner;
  config: ResolvedResearchManagerConfig;
  request: ResearchRunRequest;
  mode: "certified" | "best-effort";
  signal?: AbortSignal;
  onAttempt?: (attempt: ResearchModelAttempt) => void | Promise<void>;
}): Promise<{ plan: ResearchPlan; attempts: ResearchModelAttempt[] }> {
  const currentDate = new Date().toISOString().slice(0, 10);
  const thinking = isSolOnlyModelSet(params.config.models)
    ? "max"
    : params.request.highStakes
      ? "xhigh"
      : "high";
  const runPlanner = async (prompt: string) =>
    await params.runner.runJson<ResearchPlan>({
      role: "planner",
      mode: params.mode,
      thinking,
      priority: "critical",
      requiredContextTokens: 16_000,
      deadlineMs: params.request.deadlineMs,
      maxTokens: 6_000,
      temperature: 0.1,
      schema: RESEARCH_PLAN_SCHEMA,
      signal: params.signal,
      onAttempt: params.onAttempt,
      prompt,
    });
  const result = await runPlanner(
    [
      "Create a rigorous research plan for the user question below.",
      `Current date: ${currentDate}.`,
      `High-stakes accuracy: ${params.request.highStakes ? "yes" : "no"}.`,
      `Maximum search queries: ${params.config.retrieval.queryCount}.`,
      "Decompose the question into independently verifiable questions.",
      "Do not create more required or important questions than the maximum search-query count.",
      "Mark every explicit user requirement and every subquestion necessary to answer it as required. Use important only for useful supplemental context and optional only for genuinely nonessential context.",
      "Each required question must cover one claim family. Split questions that list multiple settings, constraints, entities, or separate asks joined by and/or.",
      "Give every limitation, comparison axis, entity, date-sensitive fact, or decision criterion explicitly named by the user its own question. Before returning, audit the user's nouns and ensure no requested aspect is hidden only inside a compound question, source requirement, or stop condition.",
      "For broad requests, prefer 12-24 atomic questions; use fewer only when the request is genuinely narrow.",
      "Create at least one distinct mapped query for each required or important question; do not collapse unrelated questions into one query.",
      "Use concise queries that favor primary and authoritative sources and include counterevidence searches.",
      "Use site:example.com only with a domain, never a URL path. Put path or page terms after the site operator.",
      "Set freshnessDays only on the individual queries whose facts can change; omit it for stable canonical specifications or documentation even when another part of the task is time-sensitive.",
      "Stop conditions must require enough evidence to answer and disclose unresolved uncertainty.",
      "User question:",
      params.request.query.trim(),
    ].join("\n"),
  );
  const initialPlan = normalizePlan(result.value, params.request, params.config);
  const compoundQuestionIds = obviousCompoundQuestionIds(initialPlan);
  if (compoundQuestionIds.length === 0) {
    return { plan: initialPlan, attempts: result.attempts };
  }

  const repair = await runPlanner(
    [
      "Rewrite the draft research plan because its required-question atomicity audit failed.",
      `Current date: ${currentDate}.`,
      `Maximum search queries: ${params.config.retrieval.queryCount}.`,
      `Compound question IDs: ${compoundQuestionIds.join(", ")}.`,
      "Preserve every explicit user requirement and every necessary subquestion, but make each required or important question answerable by one bounded claim family and one independently scored answer segment.",
      "Split comma-delimited lists, settings, files, modes, error classes, constraints, guarantees, recommendations, and separate asks joined by and/or. A relation between two entities may remain one question only when the relation itself is the single fact being researched.",
      "Use the available question capacity instead of hiding coverage inside a compound question. Give every required or important question at least one distinct mapped search query.",
      "Do not weaken priorities, drop source requirements, or turn requested coverage into an optional question.",
      `User question: ${params.request.query.trim()}`,
      `DRAFT_PLAN_JSON: ${JSON.stringify(initialPlan)}`,
    ].join("\n\n"),
  );
  const repairedPlan = normalizePlan(repair.value, params.request, params.config);
  const remainingCompoundQuestionIds = obviousCompoundQuestionIds(repairedPlan);
  if (remainingCompoundQuestionIds.length > 0) {
    throw new ResearchBlockedError(
      "capability_unavailable",
      `Planner atomicity repair retained compound required questions: ${remainingCompoundQuestionIds.join(", ")}.`,
      { compoundQuestionIds: remainingCompoundQuestionIds },
    );
  }
  return {
    plan: repairedPlan,
    attempts: [...result.attempts, ...repair.attempts],
  };
}

import type { JsonSchemaObject } from "openclaw/plugin-sdk/json-schema-runtime";

export const SOURCE_SCOUT_SCHEMA: JsonSchemaObject = {
  type: "object",
  additionalProperties: false,
  required: ["rankedSourceIds", "rejectedSourceIds", "queries", "risks"],
  properties: {
    rankedSourceIds: { type: "array", items: { type: "string" }, default: [] },
    rejectedSourceIds: { type: "array", items: { type: "string" }, default: [] },
    queries: { type: "array", items: { type: "string" }, maxItems: 8, default: [] },
    risks: { type: "array", items: { type: "string" }, maxItems: 16, default: [] },
  },
};

export const RESEARCH_PLAN_SCHEMA: JsonSchemaObject = {
  type: "object",
  additionalProperties: false,
  required: [
    "objective",
    "questions",
    "queries",
    "sourceRequirements",
    "riskLevel",
    "stopConditions",
  ],
  properties: {
    objective: { type: "string", minLength: 1 },
    questions: {
      type: "array",
      minItems: 1,
      maxItems: 24,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "question", "priority"],
        properties: {
          id: { type: "string", minLength: 1 },
          question: { type: "string", minLength: 1 },
          priority: { type: "string", enum: ["required", "important", "optional"] },
        },
      },
    },
    queries: {
      type: "array",
      minItems: 1,
      maxItems: 24,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["query", "questionIds", "preferredSourceTypes"],
        properties: {
          query: { type: "string", minLength: 1 },
          questionIds: { type: "array", items: { type: "string" }, minItems: 1 },
          freshnessDays: { type: "number", minimum: 0 },
          preferredSourceTypes: { type: "array", items: { type: "string" } },
        },
      },
    },
    sourceRequirements: { type: "array", items: { type: "string" }, minItems: 1 },
    riskLevel: { type: "string", enum: ["normal", "high"] },
    stopConditions: { type: "array", items: { type: "string" }, minItems: 1 },
  },
};

const CLAIM_SHAPE: JsonSchemaObject = {
  type: "object",
  additionalProperties: false,
  required: ["id", "questionId", "text", "sourceIds", "evidence", "confidence", "material"],
  properties: {
    id: { type: "string" },
    questionId: { type: "string" },
    text: { type: "string", minLength: 1 },
    sourceIds: { type: "array", items: { type: "string" }, minItems: 1 },
    evidence: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sourceId", "quote", "supports"],
        properties: {
          sourceId: { type: "string" },
          quote: { type: "string", minLength: 1 },
          supports: { type: "boolean" },
        },
      },
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    material: { type: "boolean" },
  },
};

export const RESEARCH_FINDING_SCHEMA: JsonSchemaObject = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "claims", "gaps"],
  properties: {
    summary: { type: "string" },
    claims: { type: "array", items: CLAIM_SHAPE, maxItems: 12 },
    gaps: { type: "array", items: { type: "string" }, maxItems: 16 },
  },
};

export const CLAIM_VERIFICATION_SCHEMA: JsonSchemaObject = {
  type: "object",
  additionalProperties: false,
  required: ["results", "gaps"],
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["claimId", "status", "confidence", "reason", "supportingSourceIds"],
        properties: {
          claimId: { type: "string" },
          status: { type: "string", enum: ["verified", "disputed", "unsupported"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          reason: { type: "string" },
          supportingSourceIds: { type: "array", items: { type: "string" } },
          contradiction: { type: "string" },
          contradictionSourceIds: { type: "array", items: { type: "string" } },
        },
      },
    },
    gaps: { type: "array", items: { type: "string" } },
  },
};

export const FINALIZATION_SCHEMA: JsonSchemaObject = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "usedClaimIds", "limitations"],
  properties: {
    answer: { type: "string", minLength: 1 },
    usedClaimIds: { type: "array", items: { type: "string" } },
    limitations: { type: "array", items: { type: "string" } },
  },
};

export const QUALITY_JUDGE_SCHEMA: JsonSchemaObject = {
  type: "object",
  additionalProperties: false,
  required: ["dimensions", "materialUnsupportedClaims", "summary"],
  properties: {
    dimensions: {
      type: "array",
      minItems: 7,
      maxItems: 7,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "score", "notes"],
        properties: {
          id: {
            type: "string",
            enum: [
              "correctness",
              "completeness",
              "sourceQuality",
              "citationEntailment",
              "freshness",
              "contradictionHandling",
              "calibration",
            ],
          },
          score: { type: "number", minimum: 0, maximum: 100 },
          notes: { type: "array", items: { type: "string" } },
        },
      },
    },
    materialUnsupportedClaims: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
};

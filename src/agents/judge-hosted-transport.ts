import { JUDGE_V2_RESPONSE_JSON_SCHEMA } from "./judge-contract.js";

export type JudgeHostedPayload = Record<string, unknown>;

export type JudgeHostedPayloadObservation = {
  payload: JudgeHostedPayload;
  model: string;
  modelVisibleTools: string[];
};

export type JudgeZeroToolPayloadObservation = {
  payload: JudgeHostedPayload;
  model: string;
  modelVisibleTools: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Enforce exact model identity and an empty tool surface for a local direct request. */
export function buildJudgeZeroToolPayload(params: {
  payload: unknown;
  expectedModel: string;
}): JudgeZeroToolPayloadObservation {
  if (!isRecord(params.payload)) {
    throw new Error("Judge provider payload is not an object");
  }
  const model = params.payload.model;
  if (!nonEmptyString(model) || model !== params.expectedModel) {
    throw new Error("Judge provider model identity drifted");
  }
  const tools = params.payload.tools;
  if (tools !== undefined && (!Array.isArray(tools) || tools.length > 0)) {
    throw new Error("Judge provider exposed model-visible tools");
  }
  return {
    payload: { ...params.payload, tools: [] },
    model,
    modelVisibleTools: [],
  };
}

/**
 * Enforce the hosted Judge request at the provider boundary.
 *
 * OpenAI Responses and ChatGPT Responses use slightly different default
 * payloads: the former omits tool fields while the latter defaults to
 * `tool_choice: auto` and `parallel_tool_calls: true`. Both are normalized
 * here to the same explicit no-tool contract, with a strict JSON schema.
 */
export function buildJudgeHostedPayload(params: {
  payload: unknown;
  expectedModel: string;
}): JudgeHostedPayloadObservation {
  if (!isRecord(params.payload)) {
    throw new Error("Judge hosted provider payload is not an object");
  }
  const model = params.payload.model;
  if (!nonEmptyString(model) || model !== params.expectedModel) {
    throw new Error("Judge hosted provider model identity drifted");
  }

  const suppliedTools = params.payload.tools;
  const modelVisibleTools = Array.isArray(suppliedTools)
    ? suppliedTools.map((tool) => {
        if (!isRecord(tool)) {
          return "unknown-tool";
        }
        const name = tool.name;
        return nonEmptyString(name) ? name : "unknown-tool";
      })
    : suppliedTools === undefined
      ? []
      : ["invalid-tools-payload"];
  if (modelVisibleTools.length > 0) {
    throw new Error("Judge hosted provider exposed model-visible tools");
  }

  const toolChoice = params.payload.tool_choice;
  if (toolChoice !== undefined && toolChoice !== "auto" && toolChoice !== "none") {
    throw new Error("Judge hosted provider tool-choice drifted");
  }
  if (
    params.payload.parallel_tool_calls !== undefined &&
    typeof params.payload.parallel_tool_calls !== "boolean"
  ) {
    throw new Error("Judge hosted provider parallel-tool flag drifted");
  }

  const text = params.payload.text;
  if (text !== undefined && !isRecord(text)) {
    throw new Error("Judge hosted provider text configuration drifted");
  }
  return {
    payload: {
      ...params.payload,
      tools: [],
      tool_choice: "none",
      parallel_tool_calls: false,
      text: {
        ...(isRecord(text) ? text : {}),
        format: {
          type: "json_schema",
          name: "judge_v2_verdict",
          strict: true,
          schema: JUDGE_V2_RESPONSE_JSON_SCHEMA,
        },
      },
    },
    model,
    modelVisibleTools: [],
  };
}

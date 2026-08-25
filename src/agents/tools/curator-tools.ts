import { Type } from "typebox";
import type { callGateway } from "../../gateway/call.js";
import { readStringParam, type AnyAgentTool, jsonResult, ToolInputError } from "./common.js";

type GatewayCaller = typeof callGateway;

const CuratorGetSchema = Type.Object(
  {
    proposalId: Type.String({ minLength: 1, maxLength: 160 }),
  },
  { additionalProperties: false },
);

const CuratorDecisionSchema = Type.Object(
  {
    proposalId: Type.String({ minLength: 1, maxLength: 160 }),
    curatorStatus: Type.Union([
      Type.Literal("accepted_for_workshop"),
      Type.Literal("rejected"),
      Type.Literal("needs_more_evidence"),
      Type.Literal("superseded"),
    ]),
    curationReview: Type.Object(
      {
        evidence: Type.Array(
          Type.Object(
            {
              sourceClass: Type.String({ minLength: 1, maxLength: 80 }),
              sourceRef: Type.String({ minLength: 1, maxLength: 160 }),
              observedAt: Type.Optional(Type.Integer({ minimum: 0 })),
            },
            { additionalProperties: false },
          ),
          { minItems: 1, maxItems: 8 },
        ),
        confidence: Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]),
        freshness: Type.Union([
          Type.Literal("current"),
          Type.Literal("stale_risk"),
          Type.Literal("unknown"),
        ]),
        privacy: Type.Union([
          Type.Literal("shared_safe"),
          Type.Literal("private_reference_only"),
          Type.Literal("blocked_sensitive"),
        ]),
        contradiction: Type.Boolean(),
        reason: Type.String({ minLength: 1, maxLength: 360 }),
        nextAction: Type.String({ minLength: 1, maxLength: 240 }),
        reviewedAt: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
    proof: Type.String({ minLength: 1, maxLength: 640 }),
  },
  { additionalProperties: false },
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function createCuratorTools(params: { callGateway: GatewayCaller }): AnyAgentTool[] {
  return [
    {
      label: "Curator proposal",
      name: "curator_get",
      description:
        "Read the supplied memory or skill proposal and its bounded evidence references.",
      parameters: CuratorGetSchema,
      execute: async (_toolCallId, args) => {
        if (!isRecord(args)) {
          throw new ToolInputError("curator_get arguments required");
        }
        const proposalId = readStringParam(args, "proposalId", { required: true });
        const result = await params.callGateway<{ proposal: unknown }>({
          method: "selfImprovement.curator.get",
          params: { id: proposalId },
        });
        return jsonResult(result);
      },
    },
    {
      label: "Curator decision",
      name: "curator_decide",
      description:
        "Record one reviewer-only curator decision with structured evidence metadata. Promotion and content writes are unavailable.",
      parameters: CuratorDecisionSchema,
      execute: async (_toolCallId, args) => {
        if (!isRecord(args)) {
          throw new ToolInputError("curator_decide arguments required");
        }
        const proposalId = readStringParam(args, "proposalId", { required: true });
        const proof = readStringParam(args, "proof", { required: true });
        const review = args.curationReview;
        if (!isRecord(review)) {
          throw new ToolInputError("curationReview required");
        }
        const curatorStatus = args.curatorStatus;
        const reviewReason = readStringParam(review, "reason", { required: true });
        if (
          (curatorStatus === "rejected" ||
            curatorStatus === "needs_more_evidence" ||
            curatorStatus === "superseded") &&
          !reviewReason
        ) {
          throw new ToolInputError("curationReview.reason required for this decision");
        }
        const updateParams = {
          id: proposalId,
          curatorStatus,
          curationReview: review,
          proof,
          reason: reviewReason,
        };
        const result = await params.callGateway<{ proposal: unknown }>({
          method: "selfImprovement.curator.update",
          params: updateParams,
        });
        return jsonResult(result);
      },
    },
  ];
}

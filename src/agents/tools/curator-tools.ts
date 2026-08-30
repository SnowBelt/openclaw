import { Type } from "typebox";
import type { callGateway } from "../../gateway/call.js";
import {
  CURATOR_CONFIDENCE_VALUES,
  CURATOR_DECISION_STATUS_VALUES,
  CURATOR_FRESHNESS_VALUES,
  CURATOR_MAX_EVIDENCE_REFERENCES,
  CURATOR_PRIVACY_VALUES,
  CURATOR_SOURCE_CLASS_VALUES,
} from "../../self-improvement/curator/contract.js";
import { stringEnum } from "../schema/string-enum.js";
import { readStringParam, type AnyAgentTool, jsonResult, ToolInputError } from "./common.js";

type GatewayCaller = typeof callGateway;

function isLegacyCuratorReviewError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("selfImprovement.curator.update") &&
    message.includes("curationReview") &&
    (message.includes("unexpected property") || message.includes("additional properties"))
  );
}

function encodeLegacyCuratorReview(review: Record<string, unknown>): string {
  return `reviewer-only-curation-review:${JSON.stringify(review)}`;
}

const CuratorGetSchema = Type.Object(
  {
    proposalId: Type.String({ minLength: 1, maxLength: 160 }),
  },
  { additionalProperties: false },
);

const CuratorDecisionSchema = Type.Object(
  {
    proposalId: Type.String({ minLength: 1, maxLength: 160 }),
    curatorStatus: stringEnum(CURATOR_DECISION_STATUS_VALUES),
    curationReview: Type.Object(
      {
        evidence: Type.Array(
          Type.Object(
            {
              sourceClass: stringEnum(CURATOR_SOURCE_CLASS_VALUES),
              sourceRef: Type.String({ minLength: 1, maxLength: 160 }),
              observedAt: Type.Optional(Type.Integer({ minimum: 0 })),
            },
            { additionalProperties: false },
          ),
          { minItems: 1, maxItems: CURATOR_MAX_EVIDENCE_REFERENCES },
        ),
        confidence: stringEnum(CURATOR_CONFIDENCE_VALUES),
        freshness: stringEnum(CURATOR_FRESHNESS_VALUES),
        privacy: stringEnum(CURATOR_PRIVACY_VALUES),
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
  let phase: "needs_read" | "reading" | "ready" | "deciding" | "done" = "needs_read";
  let readProposalId: string | undefined;
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
        if (phase !== "needs_read") {
          throw new ToolInputError("curator_get may be called exactly once per review run");
        }
        const proposalId = readStringParam(args, "proposalId", { required: true });
        phase = "reading";
        try {
          const result = await params.callGateway<{ proposal: unknown }>({
            method: "selfImprovement.curator.get",
            params: { id: proposalId },
          });
          readProposalId = proposalId;
          phase = "ready";
          return jsonResult(result);
        } catch (error) {
          phase = "needs_read";
          throw error;
        }
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
        if (phase !== "ready") {
          throw new ToolInputError(
            phase === "done" || phase === "deciding"
              ? "curator_decide may be called exactly once per review run"
              : "curator_get must complete before curator_decide",
          );
        }
        if (readProposalId !== proposalId) {
          throw new ToolInputError("curator_decide proposalId must match curator_get proposalId");
        }
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
        let result: { proposal: unknown };
        phase = "deciding";
        try {
          try {
            result = await params.callGateway<{ proposal: unknown }>({
              method: "selfImprovement.curator.update",
              params: updateParams,
            });
          } catch (error) {
            if (!isLegacyCuratorReviewError(error)) {
              throw error;
            }
            result = await params.callGateway<{ proposal: unknown }>({
              method: "selfImprovement.curator.update",
              params: {
                id: proposalId,
                curatorStatus,
                proof,
                reason: reviewReason,
                note: encodeLegacyCuratorReview(review),
              },
            });
          }
          phase = "done";
          return jsonResult(result);
        } catch (error) {
          phase = "ready";
          throw error;
        }
      },
    },
  ];
}

import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type {
  CuratorConfidence,
  CuratorDecisionStatus,
  CuratorFreshness,
  CuratorPrivacy,
  CuratorSourceClass,
} from "./contract.js";
import {
  CURATOR_CONFIDENCE_VALUES,
  CURATOR_DECISION_STATUS_VALUES,
  CURATOR_FRESHNESS_VALUES,
  CURATOR_MAX_EVIDENCE_REFERENCES,
  CURATOR_MAX_OUTPUT_TOKENS,
  CURATOR_PRIVACY_VALUES,
  CURATOR_SOURCE_CLASS_VALUES,
} from "./contract.js";
import type { CuratorReviewPacket } from "./privacy.js";

export type CuratorModelRecommendation = {
  status: CuratorDecisionStatus;
  evidence: Array<{ sourceClass: CuratorSourceClass; sourceRef: string }>;
  confidence: CuratorConfidence;
  freshness: CuratorFreshness;
  privacy: CuratorPrivacy;
  contradiction: boolean;
  reason: string;
  nextAction: string;
};

export type CuratorModelResult = {
  modelRef: string;
  recommendation: CuratorModelRecommendation;
};

export type CuratorModelAdapter = {
  recommend: (params: {
    packet: CuratorReviewPacket;
    repairIssue?: string;
  }) => Promise<CuratorModelResult>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function enumValue<T extends string>(values: readonly T[], value: unknown): T | undefined {
  return typeof value === "string" ? values.find((entry) => entry === value) : undefined;
}

function boundedString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new Error(`invalid curator recommendation field: ${field}`);
  }
  return value.trim();
}

export function parseCuratorModelRecommendation(
  text: string,
  packet: CuratorReviewPacket,
): CuratorModelRecommendation {
  let value: unknown;
  try {
    value = JSON.parse(text.trim());
  } catch {
    throw new Error("curator recommendation must be one JSON object");
  }
  if (!isRecord(value)) {
    throw new Error("curator recommendation must be an object");
  }
  const allowedKeys = new Set([
    "status",
    "evidence",
    "confidence",
    "freshness",
    "privacy",
    "contradiction",
    "reason",
    "nextAction",
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new Error("curator recommendation contains an unknown field");
  }
  const status = enumValue(CURATOR_DECISION_STATUS_VALUES, value.status);
  const confidence = enumValue(CURATOR_CONFIDENCE_VALUES, value.confidence);
  const freshness = enumValue(CURATOR_FRESHNESS_VALUES, value.freshness);
  const privacy = enumValue(CURATOR_PRIVACY_VALUES, value.privacy);
  if (
    !status ||
    !confidence ||
    !freshness ||
    !privacy ||
    typeof value.contradiction !== "boolean"
  ) {
    throw new Error("curator recommendation contains an invalid enum or contradiction value");
  }
  if (
    !Array.isArray(value.evidence) ||
    value.evidence.length < 1 ||
    value.evidence.length > CURATOR_MAX_EVIDENCE_REFERENCES
  ) {
    throw new Error("curator recommendation evidence is out of bounds");
  }
  const allowedRefs = new Set([packet.proposalId, ...packet.sourceRecommendationIds]);
  const evidence = value.evidence.map((entry) => {
    if (!isRecord(entry)) {
      throw new Error("curator recommendation evidence must be an object");
    }
    const sourceClass = enumValue(CURATOR_SOURCE_CLASS_VALUES, entry.sourceClass);
    const sourceRef = boundedString(entry.sourceRef, "evidence.sourceRef", 160);
    if (!sourceClass || !allowedRefs.has(sourceRef)) {
      throw new Error("curator recommendation cited evidence outside the bounded packet");
    }
    return { sourceClass, sourceRef };
  });
  return {
    status,
    evidence,
    confidence,
    freshness,
    privacy,
    contradiction: value.contradiction,
    reason: boundedString(value.reason, "reason", 360),
    nextAction: boundedString(value.nextAction, "nextAction", 240),
  };
}

const SYSTEM_PROMPT =
  "You are an advisory reviewer. Return one JSON object only. Never request tools, quote private data, promote content, or write files. Classify only the supplied packet.";

function userPrompt(packet: CuratorReviewPacket, repairIssue?: string): string {
  const repair = repairIssue
    ? `\nYour prior output was invalid (${repairIssue}). Return a corrected JSON object.`
    : "";
  return [
    "Review this bounded memory/skill proposal packet.",
    'Schema: {"status":"accepted_for_workshop|rejected|needs_more_evidence|superseded","evidence":[{"sourceClass":"instruction|workflow|knowledge|architecture|risk|outcome|task|task_group|cron_job|skill_workshop|skill_workshop_queue|project_health|configuration|agent","sourceRef":"one supplied id"}],"confidence":"low|medium|high","freshness":"current|stale_risk|unknown","privacy":"shared_safe|private_reference_only|blocked_sensitive","contradiction":false,"reason":"...","nextAction":"..."}',
    "Accept only current, shared-safe, non-contradictory evidence with medium-or-high confidence. Approval remains external.",
    JSON.stringify(packet),
    repair,
  ].join("\n");
}

export function createSimpleCompletionCuratorModelAdapter(params: {
  getConfig: () => OpenClawConfig;
  agentId?: string;
  modelRef?: string;
  timeoutMs?: number;
}): CuratorModelAdapter {
  return {
    recommend: async ({ packet, repairIssue }) => {
      const { prepareSimpleCompletionModelForAgent, completeWithPreparedSimpleCompletionModel } =
        await import("../../agents/simple-completion-runtime.js");
      const cfg = params.getConfig();
      const prepared = await prepareSimpleCompletionModelForAgent({
        cfg,
        agentId: params.agentId ?? "memory-knowledge-curator",
        modelRef: params.modelRef,
        allowMissingApiKeyModes: ["aws-sdk"],
      });
      if ("error" in prepared) {
        throw new Error(prepared.error);
      }
      const timeoutMs = params.timeoutMs ?? 60_000;
      const result = await completeWithPreparedSimpleCompletionModel({
        cfg,
        model: prepared.model,
        auth: prepared.auth,
        context: {
          systemPrompt: SYSTEM_PROMPT,
          messages: [
            { role: "user", content: userPrompt(packet, repairIssue), timestamp: Date.now() },
          ],
        },
        options: {
          maxTokens: CURATOR_MAX_OUTPUT_TOKENS,
          temperature: 0,
          timeoutMs,
          signal: AbortSignal.timeout(timeoutMs),
        },
      });
      const text = result.content
        .filter((entry): entry is { type: "text"; text: string } => entry.type === "text")
        .map((entry) => entry.text)
        .join("");
      return {
        modelRef: `${prepared.selection.provider}/${prepared.selection.modelId}`,
        recommendation: parseCuratorModelRecommendation(text, packet),
      };
    },
  };
}

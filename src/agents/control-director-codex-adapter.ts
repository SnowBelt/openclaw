// Governed Codex escalation decision and compact mission handoff.
import {
  resolvePccCodexEffortForWorkClass,
  type PccExecutionProfile,
} from "../pcc/execution-profile.js";
import type { ControlDirectorMissionEnvelope } from "./control-director-contract.js";
import { CONTROL_DIRECTOR_OUTPUT_QUALITY_MINIMUM } from "./control-director-quality-rubric.js";
import {
  buildCompactCodexMissionPacket,
  type CompactCodexMissionPacket,
} from "./control-director-turn-policy.js";
import {
  consumeExecutionApprovalEnvelope,
  type ExecutionApprovalDecision,
  type ExecutionApprovalEnvelope,
} from "./execution-approval-envelope.js";

export const CONTROL_DIRECTOR_LOCAL_QUALITY_THRESHOLD = CONTROL_DIRECTOR_OUTPUT_QUALITY_MINIMUM;

export type ControlDirectorCodexWorkClass = "conversation" | "routine" | "hard_work" | "checkpoint";

export type ControlDirectorCodexRouteDecision =
  | {
      route: "local";
      reason: string;
      localQualityScore?: number;
    }
  | {
      route: "codex";
      reason: string;
      modelId: string;
      effort: PccExecutionProfile["codexEffort"];
      role: Exclude<PccExecutionProfile["codexRole"], "off">;
      packet: CompactCodexMissionPacket;
      approval: ExecutionApprovalEnvelope;
      approvalDecision: Extract<ExecutionApprovalDecision, { allowed: true }>;
    }
  | {
      route: "blocked";
      reason: string;
      code:
        | "local_quality_below_gate"
        | "codex_role_not_admitted"
        | "approval_missing"
        | "approval_denied";
      approvalDecision?: ExecutionApprovalDecision;
    };

function roleAdmitsWork(
  role: PccExecutionProfile["codexRole"],
  workClass: ControlDirectorCodexWorkClass,
): boolean {
  if (role === "off") {
    return false;
  }
  if (role === "lead") {
    return workClass !== "conversation";
  }
  if (role === "hard_work") {
    return workClass === "hard_work" || workClass === "checkpoint";
  }
  return workClass === "checkpoint";
}

/**
 * Decide one route without invoking a model. Local remains the default; Codex
 * requires both an admitted profile role and a consumable project approval.
 */
export function prepareGovernedControlDirectorCodexEscalation(params: {
  profile: PccExecutionProfile;
  mission: ControlDirectorMissionEnvelope;
  actorId: string;
  resourceId: string;
  workClass: ControlDirectorCodexWorkClass;
  localQualityScore?: number;
  localAttempted?: boolean;
  state: string;
  evidence?: readonly string[];
  constraints?: readonly string[];
  approvals?: readonly ExecutionApprovalEnvelope[];
  estimatedTokens?: number;
  estimatedCostMilliUsd?: number;
  now?: number;
  qualityThreshold?: number;
}): ControlDirectorCodexRouteDecision {
  const qualityThreshold = Math.max(
    0,
    Math.min(100, params.qualityThreshold ?? CONTROL_DIRECTOR_LOCAL_QUALITY_THRESHOLD),
  );
  const localQualityScore = params.localQualityScore;
  const localPasses = localQualityScore !== undefined && localQualityScore >= qualityThreshold;
  const admitted = roleAdmitsWork(params.profile.codexRole, params.workClass);
  const profileRequiresCodex =
    params.profile.codexRole === "lead" ||
    (params.profile.codexRole === "hard_work" && params.workClass === "hard_work") ||
    (params.profile.codexRole === "checkpoints" && params.workClass === "checkpoint");
  const localShouldHandle =
    params.workClass === "conversation" ||
    (!profileRequiresCodex && (params.localAttempted !== true || localPasses));

  if (localShouldHandle) {
    return {
      route: "local",
      reason:
        params.workClass === "conversation"
          ? "Conversation stays on the responsive local lane."
          : "The local route meets the configured quality gate and no Codex role owns this step.",
      ...(localQualityScore !== undefined ? { localQualityScore } : {}),
    };
  }
  if (!admitted) {
    return {
      route: "blocked",
      code:
        params.profile.codexRole === "off" ? "local_quality_below_gate" : "codex_role_not_admitted",
      reason:
        params.profile.codexRole === "off"
          ? `Local evaluated quality ${localQualityScore ?? "unknown"} is below ${qualityThreshold}, and Codex is disabled for this profile.`
          : `Codex role ${params.profile.codexRole} does not own ${params.workClass} work.`,
    };
  }
  const approval = (params.approvals ?? []).find(
    (candidate) =>
      candidate.action === "use_codex" &&
      candidate.subjectActorId === params.actorId &&
      candidate.resource.kind === "project" &&
      (candidate.resource.id === params.resourceId || candidate.resource.id === "*"),
  );
  if (!approval) {
    return {
      route: "blocked",
      code: "approval_missing",
      reason: "Codex escalation requires a scoped project approval envelope.",
    };
  }
  const consumed = consumeExecutionApprovalEnvelope({
    envelope: approval,
    request: {
      actorId: params.actorId,
      action: "use_codex",
      resource: { kind: "project", id: params.resourceId },
      useCount: 1,
      tokenCount: Math.max(0, Math.floor(params.estimatedTokens ?? 0)),
      costMilliUsd: Math.max(0, Math.floor(params.estimatedCostMilliUsd ?? 0)),
      now: params.now,
    },
  });
  if (!consumed.decision.allowed) {
    return {
      route: "blocked",
      code: "approval_denied",
      reason: consumed.decision.reason,
      approvalDecision: consumed.decision,
    };
  }
  return {
    route: "codex",
    reason: `Codex owns this ${params.workClass} step under the ${params.profile.codexRole} profile role.`,
    modelId: params.profile.codexModelId,
    effort: resolvePccCodexEffortForWorkClass(
      params.profile.codexEffort,
      params.workClass === "conversation" ? "routine" : params.workClass,
    ),
    role: params.profile.codexRole as Exclude<PccExecutionProfile["codexRole"], "off">,
    packet: buildCompactCodexMissionPacket({
      mission: params.mission,
      state: params.state,
      evidence: params.evidence,
      constraints: params.constraints,
      tokenBudgetHint: params.estimatedTokens,
    }),
    approval: consumed.envelope,
    approvalDecision: consumed.decision,
  };
}

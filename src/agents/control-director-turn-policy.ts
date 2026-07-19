// Compiles one deterministic, mode-scoped Control Director prompt and capability budget.
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { resolveProgramManagerRoute } from "./agent-scope-config.js";
import {
  classifyControlDirectorResponseMode,
  type ControlDirectorMissionEnvelope,
  type ControlDirectorResponseMode,
} from "./control-director-contract.js";
import {
  compileControlDirectorExecutionProfile,
  type ControlDirectorExecutionProfile,
} from "./control-director-execution-profile.js";
import { isConfiguredControlDirectorAgent } from "./control-director-role.js";
import { CONTROL_DIRECTOR_UX_SLOS } from "./control-director-slos.js";

export { CONTROL_DIRECTOR_UX_SLOS } from "./control-director-slos.js";

export const CONTROL_DIRECTOR_POLICY_SCHEMA_VERSION = 1 as const;

export const CONTROL_DIRECTOR_OWNERSHIP_CHARTER = {
  chat: "Owns conversation, acknowledgement, steering, queue controls, and inline activity.",
  orchestrator:
    "Owns durable runs, tasks, mailboxes, leases, retries, fan-in, cancellation, and terminal delivery.",
  controlDirector:
    "Owns intent, prioritization, delegation, user updates, and proportional final synthesis.",
  programManager:
    "Owns scoped decomposition, worker dispatch, dependency order, and result fan-in.",
  judge: "Owns independent evidence inspection and signed claim-bound completion verdicts.",
  pcc: "Owns projects, plans, milestones, decisions, approvals, and evidence; never runtime truth.",
  sig: "Owns recurring-system-defect detection and recommendations; never silent production mutation.",
  systemQuality: "Owns diagnostics, canaries, Judge/SIG evidence, soak, and rollback records.",
} as const;

export type ControlDirectorModelRoute = "local_direct" | "local_orchestrator";

export type ControlDirectorTurnPolicy = {
  schemaVersion: typeof CONTROL_DIRECTOR_POLICY_SCHEMA_VERSION;
  mode: ControlDirectorResponseMode;
  modelRoute: ControlDirectorModelRoute;
  programManagerAgentId: string;
  programManagerRouteSource: "dedicated" | "owner_fallback";
  toolsAllow: string[];
  retainSkillsWithToolsAllow: true;
  requiresIndependentJudge: boolean;
  budgets: {
    maxPolicyChars: number;
    maxRecentMemoryChars: number;
    maxTools: number;
  };
  executionProfile: ControlDirectorExecutionProfile;
  prompt: string;
};

export type CompactCodexMissionPacket = {
  schemaVersion: 1;
  mission: ControlDirectorMissionEnvelope;
  state: string;
  evidence: string[];
  constraints: string[];
  acceptanceCriteria: string[];
  tokenBudgetHint: number;
};

const READ_ONLY_TOOLS = [
  "read",
  "memory_search",
  "memory_get",
  "sessions_list",
  "sessions_history",
  "get_goal",
  "web_search",
  "web_fetch",
  "tool_search",
] as const;

const DELEGATION_TOOLS = [
  ...READ_ONLY_TOOLS,
  "sessions_spawn",
  "sessions_send",
  "sessions_yield",
  "subagents",
  "create_goal",
  "update_goal",
  "update_plan",
] as const;

const MODE_TOOLS: Record<ControlDirectorResponseMode, readonly string[]> = {
  conversation: ["memory_search", "memory_get", "sessions_list", "sessions_history", "get_goal"],
  answer: READ_ONLY_TOOLS,
  plan: READ_ONLY_TOOLS,
  status: READ_ONLY_TOOLS,
  steer: ["sessions_list", "sessions_history", "sessions_send", "get_goal", "update_goal"],
  queue: ["sessions_list", "sessions_history", "sessions_send", "get_goal", "update_goal"],
  execute: DELEGATION_TOOLS,
  goal: DELEGATION_TOOLS,
};

function explicitModeFromQueueMode(
  queueMode: "steer" | "followup" | "collect" | "interrupt" | undefined,
): ControlDirectorResponseMode | undefined {
  if (queueMode === "steer" || queueMode === "interrupt") {
    return "steer";
  }
  if (queueMode === "followup" || queueMode === "collect") {
    return "queue";
  }
  return undefined;
}

function intersectTools(
  policy: readonly string[],
  upstream: readonly string[] | undefined,
): string[] {
  if (upstream === undefined) {
    return [...policy];
  }
  const admitted = new Set(upstream.map((entry) => entry.trim().toLowerCase()).filter(Boolean));
  return policy.filter((entry) => admitted.has(entry));
}

function modeInstructions(mode: ControlDirectorResponseMode): string[] {
  switch (mode) {
    case "conversation":
      return [
        "Respond naturally and promptly. Do not manufacture a project, blocker, or completion ceremony.",
        "If work is already active, conversation remains available and does not take ownership from the orchestrator.",
      ];
    case "answer":
      return [
        "Answer the actual question directly. Retrieve evidence only when needed and label uncertainty honestly.",
        "Do not append execution-status fields unless the user explicitly requested them.",
      ];
    case "plan":
      return [
        "Produce a complete, executable plan but do not mutate files, runtime, services, or external state.",
        "Map each requirement to an acceptance check and preserve deferred work explicitly.",
      ];
    case "status":
      return [
        "Read canonical execution state and report verified current state, active owner, latest evidence, and next action.",
        "Never infer progress from assistant prose or from a stale running label without a lease/heartbeat.",
      ];
    case "steer":
      return [
        "Acknowledge the steering mutation immediately and route it to the active durable run.",
        "Preserve revision, idempotency, mission identity, and any work already proven complete.",
      ];
    case "queue":
      return [
        "Acknowledge the queued mutation immediately and preserve its server-owned ordering and idempotency identity.",
        "Do not present queued work as admitted or running until the canonical inbox says so.",
      ];
    case "execute":
    case "goal":
      return [
        "Preserve the immutable mission envelope. Delegate mutations to the Program Manager or scoped workers; do not directly use exec, write, or patch tools.",
        "Fan worker events and evidence back into concise inline updates. Keep chat responsive while work continues.",
        "Continue safely until the mission is complete, genuinely blocked, or needs user input. A completion claim requires direct evidence and a valid independent signed Judge receipt.",
      ];
  }
  return [];
}

export function compileControlDirectorTurnPolicy(params: {
  config: OpenClawConfig;
  agentId: string;
  requestText: string;
  explicitMode?: ControlDirectorResponseMode;
  queueMode?: "steer" | "followup" | "collect" | "interrupt";
  upstreamToolsAllow?: readonly string[];
}): ControlDirectorTurnPolicy | undefined {
  if (!isConfiguredControlDirectorAgent({ config: params.config, agentId: params.agentId })) {
    return undefined;
  }
  const mode =
    params.explicitMode ??
    explicitModeFromQueueMode(params.queueMode) ??
    classifyControlDirectorResponseMode(params.requestText);
  const route = resolveProgramManagerRoute(params.config, params.agentId);
  const executionProfile = compileControlDirectorExecutionProfile({
    config: params.config,
    agentId: params.agentId,
  });
  const toolsAllow = intersectTools(MODE_TOOLS[mode], params.upstreamToolsAllow);
  const executionMode = mode === "execute" || mode === "goal";
  const prompt = [
    "## Compiled Control Director Turn Policy v1",
    `Mode: ${mode}. Model route: ${executionMode ? "local orchestrator" : "local direct"}.`,
    `Program Manager route: ${route.agentId} (${route.source}).`,
    ...modeInstructions(mode),
    `Capability budget: ${toolsAllow.length} tools; no capability outside this allowlist.`,
    `UX SLOs: ACK ${CONTROL_DIRECTOR_UX_SLOS.ackMs}ms; first activity ${CONTROL_DIRECTOR_UX_SLOS.firstActivityMs}ms; activity heartbeat ${CONTROL_DIRECTOR_UX_SLOS.activityHeartbeatMs}ms.`,
    "Codex is not the conversational default. Escalate a compact typed mission packet only through an approved execution profile when local evaluated quality is insufficient or Codex owns a configured checkpoint/hard-work/lead role.",
  ].join("\n");
  return {
    schemaVersion: CONTROL_DIRECTOR_POLICY_SCHEMA_VERSION,
    mode,
    modelRoute: executionMode ? "local_orchestrator" : "local_direct",
    programManagerAgentId: route.agentId,
    programManagerRouteSource: route.source,
    toolsAllow,
    retainSkillsWithToolsAllow: true,
    requiresIndependentJudge: executionMode,
    budgets: { maxPolicyChars: 2_400, maxRecentMemoryChars: 4_000, maxTools: 20 },
    executionProfile,
    prompt: prompt.slice(0, 2_400),
  };
}

/** Build a bounded, transcript-free Codex handoff packet for approved escalation paths. */
export function buildCompactCodexMissionPacket(params: {
  mission: ControlDirectorMissionEnvelope;
  state: string;
  evidence?: readonly string[];
  constraints?: readonly string[];
  tokenBudgetHint?: number;
}): CompactCodexMissionPacket {
  const compact = (value: string, max: number) => value.replace(/\s+/g, " ").trim().slice(0, max);
  return {
    schemaVersion: 1,
    mission: structuredClone(params.mission),
    state: compact(params.state, 2_000),
    evidence: [
      ...new Set((params.evidence ?? []).map((value) => compact(value, 500)).filter(Boolean)),
    ].slice(0, 20),
    constraints: [
      ...new Set((params.constraints ?? []).map((value) => compact(value, 300)).filter(Boolean)),
    ].slice(0, 20),
    acceptanceCriteria: [...params.mission.acceptanceCriteria],
    tokenBudgetHint: Math.max(1_000, Math.min(64_000, Math.floor(params.tokenBudgetHint ?? 8_000))),
  };
}

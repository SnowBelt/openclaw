// Heavy runtime seam for Pursue Goal worker and independent Judge turns.
import crypto from "node:crypto";
import { agentCommand } from "../agents/agent-command.js";
import { resolveJudgeAgentId } from "../agents/agent-scope-config.js";
import { prepareGovernedControlDirectorCodexEscalation } from "../agents/control-director-codex-adapter.js";
import { buildControlDirectorMissionEnvelope } from "../agents/control-director-contract.js";
import { judgeCompletionIndependently } from "../agents/independent-judge-service.js";
import { getRuntimeConfig } from "../config/io.js";
import {
  createSessionGoal,
  getSessionGoal,
  updateSessionGoalObjective,
  updateSessionGoalStatus,
} from "../config/sessions/goals.js";
import { resolveStorePath } from "../config/sessions/paths.js";
import type { SessionGoalStatus } from "../config/sessions/types.js";
import { DEFAULT_PCC_EXECUTION_PROFILE } from "../pcc/execution-profile.js";
import {
  nextPursueGoalBlockerCount,
  PURSUE_GOAL_BLOCKER_CONFIRMATION_TURNS,
} from "./pursue-goal-blocker.js";
import type {
  PursueGoalControllerRuntime,
  PursueGoalTurnInput,
  PursueGoalTurnResult,
} from "./pursue-goal-controller.js";

function collectResultText(result: unknown): string {
  if (!result || typeof result !== "object") {
    return "";
  }
  const payloads = (result as { payloads?: unknown }).payloads;
  if (!Array.isArray(payloads)) {
    return "";
  }
  return payloads
    .flatMap((payload) => {
      if (!payload || typeof payload !== "object") {
        return [];
      }
      const text = (payload as { text?: unknown }).text;
      return typeof text === "string" && text.trim() ? [text.trim()] : [];
    })
    .join("\n\n")
    .trim();
}

function collectResultArtifactIds(result: unknown): string[] {
  if (!result || typeof result !== "object") {
    return [];
  }
  const payloads = (result as { payloads?: unknown }).payloads;
  if (!Array.isArray(payloads)) {
    return [];
  }
  const ids = payloads.flatMap((payload) => {
    if (!payload || typeof payload !== "object") {
      return [];
    }
    const record = payload as { mediaUrl?: unknown; mediaUrls?: unknown };
    return [record.mediaUrl, ...(Array.isArray(record.mediaUrls) ? record.mediaUrls : [])].filter(
      (value): value is string => typeof value === "string" && Boolean(value.trim()),
    );
  });
  return [...new Set(ids)];
}

function resultModel(result: unknown): string | undefined {
  if (!result || typeof result !== "object") {
    return undefined;
  }
  const meta = (result as { meta?: unknown }).meta;
  if (!meta || typeof meta !== "object") {
    return undefined;
  }
  const agentMeta = (meta as { agentMeta?: unknown }).agentMeta;
  if (!agentMeta || typeof agentMeta !== "object") {
    return undefined;
  }
  const provider = (agentMeta as { provider?: unknown }).provider;
  const model = (agentMeta as { model?: unknown }).model;
  return typeof model === "string" && model.trim()
    ? `${typeof provider === "string" && provider.trim() ? `${provider}/` : ""}${model}`
    : undefined;
}

function workerStorePath(input: PursueGoalTurnInput): string {
  return resolveStorePath(getRuntimeConfig().session?.store, {
    agentId: input.state.workerAgentId,
  });
}

async function ensureWorkerGoal(input: PursueGoalTurnInput): Promise<void> {
  const storePath = workerStorePath(input);
  const snapshot = await getSessionGoal({
    sessionKey: input.state.workerSessionKey,
    storePath,
    persist: false,
  });
  if (snapshot.status === "missing") {
    await createSessionGoal({
      sessionKey: input.state.workerSessionKey,
      storePath,
      objective: input.goal,
      fallbackEntry: {
        sessionId: input.state.workerSessionId,
        updatedAt: Date.now(),
        totalTokens: 0,
        totalTokensFresh: true,
      },
    });
    return;
  }
  if (snapshot.goal?.objective !== input.goal && snapshot.goal?.status !== "complete") {
    await updateSessionGoalObjective({
      sessionKey: input.state.workerSessionKey,
      storePath,
      objective: input.goal,
    });
  }
  if (snapshot.goal && snapshot.goal.status !== "active" && snapshot.goal.status !== "complete") {
    await updateSessionGoalStatus({
      sessionKey: input.state.workerSessionKey,
      storePath,
      status: "active",
      note: "Pursue Goal controller resumed execution.",
    });
  }
}

/**
 * Pursue Goal is a local orchestration surface unless a future project-bound caller supplies
 * an approved profile and approval envelope. Calling the shared adapter here prevents a second,
 * implicit Codex-routing policy from growing inside the durable worker runtime.
 */
export function resolvePursueGoalCodexRoute(input: PursueGoalTurnInput) {
  return prepareGovernedControlDirectorCodexEscalation({
    profile: DEFAULT_PCC_EXECUTION_PROFILE,
    mission: buildControlDirectorMissionEnvelope({
      missionId: input.state.missionId,
      idempotencyKey: input.state.idempotencyKey,
      requestBody: input.goal,
      responseMode: "goal",
      acceptanceCriteria: [
        "The full goal is achieved or an exact persistent blocker is reported.",
        "Every completion claim is supported by direct evidence and an independent Judge receipt.",
      ],
      provenance: ["pursue-goal-controller"],
    }),
    actorId: input.state.workerAgentId,
    resourceId: input.flowId,
    workClass: "hard_work",
    localAttempted: false,
    state: input.state.nextAction ?? "Start or continue the durable goal.",
    evidence: input.state.lastResult ? [input.state.lastResult] : [],
    constraints: [
      "Keep conversation responsive through the Control Director while this worker runs.",
      "Do not invoke hosted Codex without a scoped project approval envelope.",
    ],
  });
}

export function buildPursueGoalWorkerPrompt(
  input: PursueGoalTurnInput,
  routeReason: string,
): string {
  const prior = input.state.lastResult?.trim();
  return [
    "Durable Pursue Goal execution turn.",
    `Mission id: ${input.state.missionId}`,
    `Flow id: ${input.flowId}`,
    `Goal version: ${input.state.goalVersion}`,
    "Original goal (authoritative):",
    `<pursue-goal>${input.goal}</pursue-goal>`,
    prior ? `Prior verified turn summary: ${prior}` : undefined,
    input.state.nextAction ? `Next action: ${input.state.nextAction}` : undefined,
    `Execution route: local Program Manager/worker lane. ${routeReason}`,
    "Act now; do not stop at a plan unless an external approval or user decision is truly required.",
    "Delegate scoped execution to workers when tools or specialist agents are available, then fan results back in.",
    "Record direct evidence for every completion claim. Do not repeat completed mutating work.",
    "The controller owns independent Judge execution. Never request, fabricate, or wait for a Judge receipt.",
    "When the work is complete, call update_goal status=complete; the controller will then run the independent Judge automatically.",
    `Worker blocker confirmation is ${input.state.consecutiveBlockers}/${PURSUE_GOAL_BLOCKER_CONFIRMATION_TURNS}. An unrun Judge is not a blocker.`,
    "Use update_goal status=complete only when the entire goal is achieved and directly verified.",
    "Use update_goal status=blocked only after the same genuine blocker persists for three consecutive goal turns.",
    "Otherwise leave the goal active so the controller can schedule the next execution turn.",
    "End with a concise verified-state update and the next concrete action.",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n\n");
}

async function loadWorkerGoal(
  input: PursueGoalTurnInput,
): Promise<{ status?: SessionGoalStatus; note?: string }> {
  const snapshot = await getSessionGoal({
    sessionKey: input.state.workerSessionKey,
    storePath: workerStorePath(input),
  });
  return {
    status: snapshot.goal?.status,
    ...(snapshot.goal?.lastStatusNote?.trim() ? { note: snapshot.goal.lastStatusNote.trim() } : {}),
  };
}

async function runIndependentJudge(params: {
  input: PursueGoalTurnInput;
  finalText: string;
  evidenceSummary: string;
  artifactIds: string[];
}) {
  const cfg = getRuntimeConfig();
  const judgeAgentId = resolveJudgeAgentId(cfg);
  return await judgeCompletionIndependently({
    missionId: params.input.state.missionId,
    requestBody: params.input.goal,
    finalText: params.finalText,
    evidenceSummary: params.evidenceSummary,
    artifactIds: params.artifactIds,
    runModel: judgeAgentId
      ? async (prompt) => {
          const runId = crypto.randomUUID();
          const result = await agentCommand({
            message: prompt,
            transcriptMessage: "Independent Judge completion review.",
            agentId: judgeAgentId,
            sessionKey: `agent:${judgeAgentId}:judge:${params.input.state.missionId}`,
            sessionId: crypto.randomUUID(),
            runId,
            deliver: false,
            modelRun: true,
            promptMode: "none",
            suppressPromptPersistence: true,
            sessionEffects: "internal",
            disableMessageTool: true,
            abortSignal: params.input.abortSignal,
          });
          return {
            text: collectResultText(result),
            runId,
            agentId: judgeAgentId,
            model: resultModel(result),
          };
        }
      : undefined,
  });
}

async function runTurn(input: PursueGoalTurnInput): Promise<PursueGoalTurnResult> {
  await ensureWorkerGoal(input);
  const route = resolvePursueGoalCodexRoute(input);
  if (route.route !== "local") {
    return {
      status: "blocked",
      text: "",
      blocker: `Pursue Goal routing failed closed: ${route.reason}`,
    };
  }
  const result = await agentCommand({
    message: buildPursueGoalWorkerPrompt(input, route.reason),
    transcriptMessage: `Pursue Goal turn ${input.state.turnCount + 1}: ${input.goal}`,
    agentId: input.state.workerAgentId,
    sessionKey: input.state.workerSessionKey,
    sessionId: input.state.workerSessionId,
    runId: input.runId,
    deliver: false,
    abortSignal: input.abortSignal,
    allowGatewaySubagentBinding: true,
    disableMessageTool: true,
    inputProvenance: {
      kind: "internal_system",
      sourceTool: "pursue_goal_controller",
      sourceSessionKey: input.state.workerSessionKey,
    },
  });
  const text = collectResultText(result);
  const artifactIds = collectResultArtifactIds(result);
  const workerGoal = await loadWorkerGoal(input);
  const goalStatus = workerGoal.status;
  if (goalStatus === "complete") {
    const evidenceSummary = text || "Worker marked the goal complete without a visible summary.";
    const judge = await runIndependentJudge({
      input,
      finalText: text,
      evidenceSummary,
      artifactIds,
    });
    return {
      status: judge.approved ? "complete" : "blocked",
      text,
      artifactIds,
      evidenceSummary,
      judgeReceipt: judge.receipt,
      blocker: judge.approved
        ? undefined
        : `Independent Judge ${judge.receipt.verdict}: ${judge.receipt.conditions}`,
      model: resultModel(result),
    };
  }
  if (goalStatus === "blocked") {
    const blocker = workerGoal.note || text || "Worker recorded a persistent blocker.";
    const blockerCount = nextPursueGoalBlockerCount({
      previousSummary: input.state.lastError,
      previousCount: input.state.consecutiveBlockers,
      currentSummary: blocker,
    });
    if (blockerCount < PURSUE_GOAL_BLOCKER_CONFIRMATION_TURNS) {
      await updateWorkerGoalStatus(
        input.state,
        "active",
        `Controller retrying provisional blocker (${blockerCount}/${PURSUE_GOAL_BLOCKER_CONFIRMATION_TURNS}).`,
      );
      return {
        status: "active",
        text,
        artifactIds,
        provisionalBlocker: blocker,
        model: resultModel(result),
      };
    }
    return {
      status: "blocked",
      text,
      artifactIds,
      blocker,
      model: resultModel(result),
    };
  }
  if (goalStatus === "paused") {
    return { status: "paused", text, artifactIds, model: resultModel(result) };
  }
  return {
    status: "active",
    text,
    artifactIds,
    model: resultModel(result),
  };
}

async function updateWorkerGoalStatus(
  state: PursueGoalTurnInput["state"],
  status: "active" | "paused" | "blocked" | "complete",
  note: string,
) {
  const storePath = resolveStorePath(getRuntimeConfig().session?.store, {
    agentId: state.workerAgentId,
  });
  const snapshot = await getSessionGoal({
    sessionKey: state.workerSessionKey,
    storePath,
    persist: false,
  });
  if (snapshot.status === "missing") {
    return;
  }
  await updateSessionGoalStatus({
    sessionKey: state.workerSessionKey,
    storePath,
    status,
    note,
  });
}

export const defaultPursueGoalControllerRuntime: PursueGoalControllerRuntime = {
  runTurn,
  pauseWorkerGoal: async (state) =>
    await updateWorkerGoalStatus(state, "paused", "Paused from Control UI."),
  resumeWorkerGoal: async (state) =>
    await updateWorkerGoalStatus(state, "active", "Resumed from Control UI."),
  stopWorkerGoal: async (state) =>
    await updateWorkerGoalStatus(state, "blocked", "Stopped from Control UI."),
  editWorkerGoal: async (state, goal) => {
    const storePath = resolveStorePath(getRuntimeConfig().session?.store, {
      agentId: state.workerAgentId,
    });
    const snapshot = await getSessionGoal({
      sessionKey: state.workerSessionKey,
      storePath,
      persist: false,
    });
    if (snapshot.status === "found" && snapshot.goal?.status !== "complete") {
      await updateSessionGoalObjective({
        sessionKey: state.workerSessionKey,
        storePath,
        objective: goal,
      });
    }
  },
};

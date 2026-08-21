// Heavy runtime seam for Pursue Goal worker and independent Judge turns.
import crypto from "node:crypto";
import { agentCommand } from "../agents/agent-command.js";
import { resolveJudgeAgentId } from "../agents/agent-scope-config.js";
import { prepareGovernedControlDirectorCodexEscalation } from "../agents/control-director-codex-adapter.js";
import { buildControlDirectorMissionEnvelope } from "../agents/control-director-contract.js";
import { collectDeliveredMediaUrls } from "../agents/embedded-agent-runner/delivery-evidence.js";
import { judgeCompletionIndependently } from "../agents/independent-judge-service.js";
import {
  JUDGE_HOSTED_MODEL,
  JUDGE_MAX_OUTPUT_TOKENS,
  type JudgeModelExecutionEvidence,
} from "../agents/judge-contract.js";
import {
  buildJudgeHostedPayload,
  buildJudgeZeroToolPayload,
} from "../agents/judge-hosted-transport.js";
import {
  acquireJudgeLocalAdmission,
  assessJudgeLocalCapacity,
  JUDGE_LOCAL_BACKUP_WAIT_MS,
  JUDGE_LOCAL_PRIMARY_WAIT_MS,
} from "../agents/judge-local-admission.js";
import { resolveJudgeModelCandidates } from "../agents/judge-model-router.js";
import {
  prepareSimpleCompletionModelForAgent,
  resolveSimpleCompletionSelectionForAgent,
} from "../agents/simple-completion-runtime.js";
import { getRuntimeConfig } from "../config/io.js";
import {
  createSessionGoal,
  getSessionGoal,
  updateSessionGoalObjective,
  updateSessionGoalStatus,
} from "../config/sessions/goals.js";
import { resolveStorePath } from "../config/sessions/paths.js";
import type { SessionGoalStatus } from "../config/sessions/types.js";
import { completeSimple } from "../llm/stream.js";
import type { AssistantMessage } from "../llm/types.js";
import { loadWebMediaRaw } from "../media/web-media.js";
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

const JUDGE_ARTIFACT_MAX_COUNT = 8;
const JUDGE_ARTIFACT_MAX_BYTES = 16 * 1024 * 1024;
const JUDGE_ARTIFACT_MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const JUDGE_ARTIFACT_DEADLINE_MS = 10_000;
const JUDGE_ARTIFACT_READ_IDLE_MS = 5_000;

type ArtifactCollectionLimits = {
  maxCount: number;
  maxBytes: number;
  maxTotalBytes: number;
  deadlineMs: number;
  readIdleTimeoutMs: number;
};

const DEFAULT_ARTIFACT_COLLECTION_LIMITS: ArtifactCollectionLimits = {
  maxCount: JUDGE_ARTIFACT_MAX_COUNT,
  maxBytes: JUDGE_ARTIFACT_MAX_BYTES,
  maxTotalBytes: JUDGE_ARTIFACT_MAX_TOTAL_BYTES,
  deadlineMs: JUDGE_ARTIFACT_DEADLINE_MS,
  readIdleTimeoutMs: JUDGE_ARTIFACT_READ_IDLE_MS,
};

async function loadArtifactBeforeDeadline(params: {
  reference: string;
  loadMedia: typeof loadWebMediaRaw;
  parentSignal?: AbortSignal;
  timeoutMs: number;
  maxBytes: number;
  readIdleTimeoutMs: number;
}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  params.parentSignal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, params.timeoutMs);
  const aborted = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener(
      "abort",
      () => reject(Object.assign(new Error("artifact load aborted"), { name: "AbortError" })),
      { once: true },
    );
  });
  try {
    return await Promise.race([
      params.loadMedia(params.reference, {
        maxBytes: params.maxBytes,
        readIdleTimeoutMs: params.readIdleTimeoutMs,
        requestInit: { signal: controller.signal },
      }),
      aborted,
    ]);
  } finally {
    clearTimeout(timer);
    params.parentSignal?.removeEventListener("abort", abort);
  }
}

/** Resolve delivered media through the guarded loader and bind evidence to bytes, not a URL. */
export async function collectResultArtifactIds(
  result: unknown,
  loadMedia: typeof loadWebMediaRaw = loadWebMediaRaw,
  abortSignal?: AbortSignal,
  limits: ArtifactCollectionLimits = DEFAULT_ARTIFACT_COLLECTION_LIMITS,
): Promise<string[]> {
  if (!result || typeof result !== "object" || abortSignal?.aborted) {
    return [];
  }
  const startedAt = Date.now();
  const references = collectDeliveredMediaUrls(result).slice(0, limits.maxCount);
  const ids = new Set<string>();
  let totalBytes = 0;
  for (const reference of references) {
    const remainingMs = limits.deadlineMs - (Date.now() - startedAt);
    const remainingBytes = limits.maxTotalBytes - totalBytes;
    if (abortSignal?.aborted || remainingMs <= 0 || remainingBytes <= 0) {
      break;
    }
    try {
      const media = await loadArtifactBeforeDeadline({
        reference,
        loadMedia,
        parentSignal: abortSignal,
        timeoutMs: remainingMs,
        maxBytes: Math.min(limits.maxBytes, remainingBytes),
        readIdleTimeoutMs: Math.min(limits.readIdleTimeoutMs, remainingMs),
      });
      if (totalBytes + media.buffer.byteLength > limits.maxTotalBytes) {
        break;
      }
      totalBytes += media.buffer.byteLength;
      ids.add(`artifact-sha256:${crypto.createHash("sha256").update(media.buffer).digest("hex")}`);
    } catch {
      // Unreadable, unsafe, oversized, or unavailable references are not evidence.
    }
  }
  return [...ids];
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

/** Report tool activity, but authorize evidence only from content-bound artifact bytes. */
export function collectObservedWorkerEvidence(result: unknown, artifactIds: readonly string[]) {
  const meta =
    result && typeof result === "object" && (result as { meta?: unknown }).meta
      ? (result as { meta: Record<string, unknown> }).meta
      : undefined;
  const trace =
    meta?.executionTrace && typeof meta.executionTrace === "object"
      ? (meta.executionTrace as Record<string, unknown>)
      : undefined;
  const toolSummary =
    meta?.toolSummary && typeof meta.toolSummary === "object"
      ? (meta.toolSummary as Record<string, unknown>)
      : undefined;
  const calls =
    typeof toolSummary?.calls === "number" && Number.isSafeInteger(toolSummary.calls)
      ? Math.max(0, toolSummary.calls)
      : 0;
  const failures =
    typeof toolSummary?.failures === "number" && Number.isSafeInteger(toolSummary.failures)
      ? Math.max(0, toolSummary.failures)
      : undefined;
  const tools = Array.isArray(toolSummary?.tools)
    ? toolSummary.tools
        .filter((tool): tool is string => typeof tool === "string" && Boolean(tool.trim()))
        .slice(0, 32)
        .map((tool) => tool.slice(0, 128))
    : [];
  const runner =
    typeof trace?.runner === "string" && trace.runner.trim() ? trace.runner.trim() : "unknown";
  const observations = [
    `worker runtime=${runner}`,
    `observed tool calls=${calls}`,
    failures === undefined ? "tool failures=unknown" : `tool failures=${failures}`,
    tools.length > 0 ? `activity tools=${tools.join(",")}` : "activity tools=none",
    artifactIds.length > 0 ? `artifact digests=${artifactIds.join(",")}` : "artifacts=none",
  ];
  return {
    summary: observations.join("; "),
    observed: artifactIds.length > 0,
  };
}

function assistantMessageText(result: AssistantMessage): string {
  return result.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .trim();
}

function directJudgeModelIdentity(result: AssistantMessage): string {
  return `${result.provider}/${result.model}`;
}

function failedDirectJudgeResult(params: {
  agentId: string;
  model: string;
  reason: string;
  requestCount?: number;
  route: JudgeModelExecutionEvidence["route"];
}): {
  text: string;
  runId: string;
  agentId: string;
  model: string;
  executionEvidence: JudgeModelExecutionEvidence;
} {
  return {
    text: `Judge request failed closed: ${params.reason}`,
    runId: `judge-failed-${crypto.randomUUID()}`,
    agentId: params.agentId,
    model: params.model,
    executionEvidence: {
      requestCount: params.requestCount ?? 0,
      modelVisibleTools: [],
      route: params.route,
      model: params.model,
    },
  };
}

/**
 * Every Judge candidate uses a direct simple-completion transport. This is
 * deliberately separate from agentCommand so no candidate can inherit the
 * generic fallback chain, workspace, session, or tool surface.
 */
/** Provider-owned direct hosted transport; exported only for the focused contract test. */
export async function runDirectJudgeModel(params: {
  cfg: ReturnType<typeof getRuntimeConfig>;
  agentId: string;
  prompt: string;
  abortSignal: AbortSignal;
  modelRef: string;
  route: "local" | "hosted";
}): Promise<
  | {
      text: string;
      runId: string;
      agentId: string;
      model: string;
      executionEvidence: JudgeModelExecutionEvidence;
    }
  | undefined
> {
  const selection = resolveSimpleCompletionSelectionForAgent({
    cfg: params.cfg,
    agentId: params.agentId,
    modelRef: params.modelRef,
  });
  if (!selection) {
    return undefined;
  }
  const requestedModel = `${selection.provider}/${selection.modelId}`;
  if (params.route === "hosted" && requestedModel !== JUDGE_HOSTED_MODEL) {
    return failedDirectJudgeResult({
      agentId: params.agentId,
      model: requestedModel,
      reason: "hosted Judge model is not the pinned GPT-5.6 route",
      route: params.route,
    });
  }
  if (
    params.route === "local" &&
    selection.provider !== "ollama" &&
    selection.provider !== "omlx"
  ) {
    return undefined;
  }
  const prepared = await prepareSimpleCompletionModelForAgent({
    cfg: params.cfg,
    agentId: params.agentId,
    agentDir: selection.agentDir,
    modelRef: requestedModel,
    allowBundledStaticCatalogFallback: true,
    useAsyncModelResolution: true,
    skipAgentDiscovery: true,
  });
  if ("error" in prepared) {
    return failedDirectJudgeResult({
      agentId: params.agentId,
      model: requestedModel,
      reason: "model preparation failed",
      route: params.route,
    });
  }
  const model = prepared.model;
  if (`${model.provider}/${model.id}` !== requestedModel) {
    return failedDirectJudgeResult({
      agentId: params.agentId,
      model: requestedModel,
      reason: "Judge model identity drifted",
      route: params.route,
    });
  }
  if (
    params.route === "hosted" &&
    model.api !== "openai-responses" &&
    model.api !== "openai-chatgpt-responses"
  ) {
    return failedDirectJudgeResult({
      agentId: params.agentId,
      model: requestedModel,
      reason: "hosted model does not expose a Responses transport",
      route: params.route,
    });
  }

  let requestPrepared = false;
  let modelVisibleTools: string[] = [];
  let response: AssistantMessage;
  try {
    response = await completeSimple(
      model,
      {
        systemPrompt:
          "You are a technical-only Judge. Never evaluate ethics, morality, politics, values, or social good. Return only the requested JSON object.",
        messages: [
          {
            role: "user",
            content: params.prompt,
            timestamp: Date.now(),
          },
        ],
        tools: [],
      },
      {
        apiKey: prepared.auth.apiKey,
        signal: params.abortSignal,
        timeoutMs: 120_000,
        maxTokens: JUDGE_MAX_OUTPUT_TOKENS,
        maxRetries: 0,
        transport: "sse",
        onPayload: (payload) => {
          if (requestPrepared) {
            throw new Error("Judge transport prepared more than one physical request");
          }
          const observation =
            params.route === "hosted"
              ? buildJudgeHostedPayload({ payload, expectedModel: model.id })
              : buildJudgeZeroToolPayload({ payload, expectedModel: model.id });
          requestPrepared = true;
          modelVisibleTools = observation.modelVisibleTools;
          return observation.payload;
        },
      },
    );
  } catch {
    return failedDirectJudgeResult({
      agentId: params.agentId,
      model: requestedModel,
      reason: "provider invocation failed",
      requestCount: requestPrepared ? 1 : 0,
      route: params.route,
    });
  }

  const responseToolNames = response.content.flatMap((block) =>
    block.type === "toolCall" ? [block.name.trim() || "unknown-tool"] : [],
  );
  modelVisibleTools = [...new Set([...modelVisibleTools, ...responseToolNames])];
  const modelIdentity = directJudgeModelIdentity(response);
  if (modelIdentity !== requestedModel) {
    modelVisibleTools = [...new Set([...modelVisibleTools, "model-identity-drift"])];
  }
  return {
    text:
      response.stopReason === "stop" || response.stopReason === "length"
        ? assistantMessageText(response)
        : "Judge provider returned an error.",
    runId: `judge-${params.route}-${crypto.randomUUID()}`,
    agentId: params.agentId,
    model: modelIdentity,
    executionEvidence: {
      requestCount: requestPrepared ? 1 : 0,
      modelVisibleTools,
      route: params.route,
      model: modelIdentity,
    },
  };
}

/** Backward-compatible focused entrypoint for hosted-only contract tests. */
export async function runDirectHostedJudgeModel(params: {
  cfg: ReturnType<typeof getRuntimeConfig>;
  agentId: string;
  prompt: string;
  abortSignal: AbortSignal;
}) {
  return await runDirectJudgeModel({
    ...params,
    modelRef: JUDGE_HOSTED_MODEL,
    route: "hosted",
  });
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
  observedEvidence: boolean;
}) {
  const cfg = getRuntimeConfig();
  const judgeAgentId = resolveJudgeAgentId(cfg);
  return await judgeCompletionIndependently({
    missionId: params.input.state.missionId,
    requestBody: params.input.goal,
    finalText: params.finalText,
    evidenceSummary: params.evidenceSummary,
    artifactIds: params.artifactIds,
    observedEvidence: params.observedEvidence,
    beforeModel: params.input.reserveJudgeExecution,
    runModel: judgeAgentId
      ? async (prompt) => {
          const candidates = resolveJudgeModelCandidates(cfg, judgeAgentId);
          for (const [index, candidate] of candidates.entries()) {
            let release: (() => void) | undefined;
            if (candidate.route === "local") {
              const capacity = await assessJudgeLocalCapacity({
                config: cfg,
                selectedModel: candidate.ref,
              });
              if (capacity.decision === "hosted_fallback") {
                continue;
              }
              const admission = await acquireJudgeLocalAdmission({
                ownerId: params.input.flowId,
                timeoutMs: index === 0 ? JUDGE_LOCAL_PRIMARY_WAIT_MS : JUDGE_LOCAL_BACKUP_WAIT_MS,
                signal: params.input.abortSignal,
              });
              if (!admission.admitted) {
                continue;
              }
              release = admission.release;
              const recheck = await assessJudgeLocalCapacity({
                config: cfg,
                selectedModel: candidate.ref,
                leaseHeld: true,
              });
              if (recheck.decision !== "admit") {
                release();
                continue;
              }
            }
            try {
              const result = await runDirectJudgeModel({
                cfg,
                agentId: judgeAgentId,
                prompt,
                abortSignal: params.input.abortSignal,
                modelRef: candidate.ref,
                route: candidate.route,
              });
              if (!result) {
                continue;
              }
              if (
                result.executionEvidence.requestCount === 0 &&
                !params.input.abortSignal.aborted
              ) {
                continue;
              }
              return result;
            } finally {
              release?.();
            }
          }
          return failedDirectJudgeResult({
            agentId: judgeAgentId,
            model: "none",
            reason: "all explicit Judge candidates were unavailable before request start",
            route: "unknown",
          });
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
  const artifactIds = await collectResultArtifactIds(result, loadWebMediaRaw, input.abortSignal);
  const workerGoal = await loadWorkerGoal(input);
  const goalStatus = workerGoal.status;
  if (goalStatus === "complete") {
    const observedEvidence = collectObservedWorkerEvidence(result, artifactIds);
    const judge = await runIndependentJudge({
      input,
      finalText: text,
      evidenceSummary: observedEvidence.summary,
      artifactIds,
      observedEvidence: observedEvidence.observed,
    });
    return {
      status: judge.approved ? "complete" : "blocked",
      text,
      artifactIds,
      evidenceSummary: observedEvidence.summary,
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

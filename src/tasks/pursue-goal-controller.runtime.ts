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
  JUDGE_MODEL_REQUEST_COUNT,
  JUDGE_MAX_OUTPUT_TOKENS,
  parseJudgeV2ModelOutput,
  judgeTrustedEvidenceReferenceList,
  type JudgeTrustedEvidence,
  type JudgeModelExecutionEvidence,
} from "../agents/judge-contract.js";
import {
  buildJudgeHostedPayload,
  buildJudgeZeroToolPayload,
} from "../agents/judge-hosted-transport.js";
import {
  acquireLocalInferenceAdmission,
  assessJudgeLocalCapacity,
  markLocalInferenceAdmissionHeld,
  JUDGE_LOCAL_BACKUP_WAIT_MS,
  JUDGE_LOCAL_PRIMARY_WAIT_MS,
} from "../agents/judge-local-admission.js";
import {
  isJudgeLocalProvider,
  isJudgePreparedLocalModel,
  resolveJudgeModelCandidates,
} from "../agents/judge-model-router.js";
import { markJudgeTransportModel } from "../agents/provider-transport-fetch.js";
import {
  prepareSimpleCompletionModelForAgent,
  resolveSimpleCompletionSelectionForAgent,
} from "../agents/simple-completion-runtime.js";
import { prepareModelForSimpleCompletion } from "../agents/simple-completion-transport.js";
import { getRuntimeConfig } from "../config/io.js";
import {
  createSessionGoal,
  getSessionGoal,
  updateSessionGoalObjective,
  updateSessionGoalStatus,
} from "../config/sessions/goals.js";
import { resolveStorePath } from "../config/sessions/paths.js";
import type { SessionGoalStatus } from "../config/sessions/types.js";
import { completeJudgeSimple, completeSimple } from "../llm/stream.js";
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
function goalEvidenceExplicitTargets(request: string | undefined): string[] {
  if (!request?.trim()) {
    return [];
  }
  const targets = request.match(
    /(?:[a-z0-9_.-]+\/[a-z0-9_./-]+|[a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+){1,})/giu,
  );
  return [...new Set((targets ?? []).map((target) => target.toLowerCase()))].slice(0, 16);
}

function evidenceMatchesExplicitTarget(evidenceText: string, target: string): boolean {
  const normalizedTarget = target.toLowerCase().replaceAll("\\", "/");
  if (evidenceText.includes(normalizedTarget)) {
    return true;
  }
  // A source target such as foo.ts is normally verified by foo.test.ts or
  // foo.spec.ts. Treat those sibling test suffixes as the same target while
  // retaining directory binding; do not accept an unrelated basename.
  const extensionless = normalizedTarget.replace(/\.[a-z0-9]+$/iu, "");
  return [".test", ".spec", "/test/", "/tests/", "/spec/", "/specs/"].some((suffix) =>
    evidenceText.includes(`${extensionless}${suffix}`),
  );
}

function isVerifiedTestCommand(command: string): boolean {
  const normalized = command.trim();
  if (!normalized) {
    return false;
  }
  const withoutEnvironment = normalized.replace(
    /^(?:env\s+)?(?:[A-Z_][A-Z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s+)*/u,
    "",
  );
  if (/(?:^|\s)(?:\|\||&&|;|\|)(?:\s|$)/u.test(withoutEnvironment)) {
    return false;
  }
  if (
    /^(?:pnpm|npm|yarn|bun)\s+(?:exec\s+)?(?:node|python3?|py)\s+(?:-e|--eval|-p|--print|-c|--command)\b/iu.test(
      withoutEnvironment,
    ) ||
    /^(?:node|python3?|py)\s+(?:-e|--eval|-p|--print|-c|--command)\b/iu.test(withoutEnvironment) ||
    /^(?:pnpm|npm|yarn|bun)\s+(?:exec|dlx|x)(?:\s+--\S+)*\s+(?:echo|printf|true|false|sh|bash|zsh|cmd|powershell)\b/iu.test(
      withoutEnvironment,
    )
  ) {
    return false;
  }
  return /^(?:pnpm|npm|yarn|bun|node|python3?|pytest|vitest|cargo|go|swift)(?:\s|$)/iu.test(
    withoutEnvironment,
  );
}

export function collectObservedWorkerEvidence(
  result: unknown,
  artifactIds: readonly string[],
  goalRequest?: string,
) {
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
  const toolObservations = Array.isArray(toolSummary?.observations)
    ? toolSummary.observations.filter(
        (observation): observation is Record<string, unknown> =>
          Boolean(observation) && typeof observation === "object" && !Array.isArray(observation),
      )
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
  const trustedObservationEvidence: JudgeTrustedEvidence[] = [];
  for (const observation of toolObservations.slice(0, 128)) {
    const toolName = typeof observation.toolName === "string" ? observation.toolName.trim() : "";
    const terminalStatus =
      observation.terminalStatus === "succeeded" || observation.terminalStatus === "failed"
        ? observation.terminalStatus
        : undefined;
    if (!toolName || terminalStatus !== "succeeded") {
      continue;
    }
    const actionFingerprint =
      typeof observation.actionFingerprint === "string" ? observation.actionFingerprint.trim() : "";
    const observationMeta = typeof observation.meta === "string" ? observation.meta.trim() : "";
    const resultDigest =
      typeof observation.resultDigest === "string" &&
      /^[a-f0-9]{64}$/iu.test(observation.resultDigest)
        ? observation.resultDigest.toLowerCase()
        : "";
    const exitCode =
      typeof observation.exitCode === "number" && Number.isSafeInteger(observation.exitCode)
        ? observation.exitCode
        : undefined;
    const asyncTaskId =
      typeof observation.asyncTaskId === "string" && observation.asyncTaskId.trim()
        ? observation.asyncTaskId.trim()
        : undefined;
    const asyncTaskRunId =
      typeof observation.asyncTaskRunId === "string" && observation.asyncTaskRunId.trim()
        ? observation.asyncTaskRunId.trim()
        : undefined;
    const postStateDigest =
      typeof observation.postStateDigest === "string" &&
      /^[a-f0-9]{64}$/iu.test(observation.postStateDigest)
        ? observation.postStateDigest.toLowerCase()
        : "";
    const fileTarget =
      observation.fileTarget &&
      typeof observation.fileTarget === "object" &&
      !Array.isArray(observation.fileTarget)
        ? (observation.fileTarget as Record<string, unknown>)
        : undefined;
    const path = typeof fileTarget?.path === "string" ? fileTarget.path.trim() : "";
    const oldpath = typeof fileTarget?.oldpath === "string" ? fileTarget.oldpath.trim() : "";
    const affectedPaths = Array.isArray(fileTarget?.paths)
      ? fileTarget.paths.filter((value): value is string => typeof value === "string").slice(0, 64)
      : [];
    const identity = actionFingerprint || path || oldpath || observationMeta;
    if (!identity) {
      continue;
    }
    const digest = crypto
      .createHash("sha256")
      .update(
        JSON.stringify({ toolName, terminalStatus, identity, resultDigest, postStateDigest }),
        "utf8",
      )
      .digest("hex");
    const detail = [
      `tool=${toolName}`,
      path ? `path=${path}` : undefined,
      oldpath ? `oldpath=${oldpath}` : undefined,
      affectedPaths.length ? `paths=${affectedPaths.join(",")}` : undefined,
      actionFingerprint ? `action=${actionFingerprint}` : undefined,
      !actionFingerprint && observationMeta ? `command=${observationMeta}` : undefined,
      `status=${terminalStatus}`,
      resultDigest ? `resultDigest=sha256:${resultDigest}` : "resultDigest=missing",
      postStateDigest ? `postStateDigest=sha256:${postStateDigest}` : undefined,
    ]
      .filter(Boolean)
      .join(" ");
    const normalizedTool = toolName.toLowerCase();
    const actionText = `${actionFingerprint} ${observationMeta}`.toLowerCase();
    const readOnlyAction =
      /(?:^|[|:=\s])(?:read|get|list|status|show|fetch|search|query|view|inspect|check|probe|poll|schema\.lookup)\b/u.test(
        actionText,
      );
    const isConfigObservation =
      normalizedTool === "config" ||
      normalizedTool === "gateway" ||
      normalizedTool.startsWith("config_") ||
      actionFingerprint.includes("config");
    const isFileMutation =
      (normalizedTool === "write" ||
        normalizedTool === "edit" ||
        normalizedTool === "apply_patch") &&
      Boolean(actionFingerprint && (path || oldpath || affectedPaths.length));
    const pairedBackgroundExec =
      normalizedTool === "process" &&
      terminalStatus === "succeeded" &&
      exitCode === 0 &&
      (asyncTaskId || asyncTaskRunId)
        ? toolObservations.find((candidate) => {
            if (!candidate || typeof candidate !== "object") {
              return false;
            }
            const candidateTool =
              typeof candidate.toolName === "string" ? candidate.toolName.trim().toLowerCase() : "";
            if (
              (candidateTool !== "exec" && candidateTool !== "bash") ||
              candidate.terminalStatus !== "running"
            ) {
              return false;
            }
            const candidateId =
              typeof candidate.asyncTaskId === "string" && candidate.asyncTaskId.trim()
                ? candidate.asyncTaskId.trim()
                : undefined;
            const candidateRunId =
              typeof candidate.asyncTaskRunId === "string" && candidate.asyncTaskRunId.trim()
                ? candidate.asyncTaskRunId.trim()
                : undefined;
            return Boolean(
              (asyncTaskId && candidateId === asyncTaskId) ||
              (asyncTaskRunId && candidateRunId === asyncTaskRunId),
            );
          })
        : undefined;
    const pairedCommand =
      pairedBackgroundExec && typeof pairedBackgroundExec.meta === "string"
        ? pairedBackgroundExec.meta.trim()
        : "";
    const verificationCommand =
      normalizedTool === "exec" || normalizedTool === "bash" ? observationMeta : pairedCommand;
    const isTestExecution =
      (normalizedTool === "exec" || normalizedTool === "bash" || Boolean(pairedBackgroundExec)) &&
      exitCode === 0 &&
      isVerifiedTestCommand(verificationCommand) &&
      /\b(?:test|check|lint|typecheck|build|verify|validate)\b/u.test(verificationCommand) &&
      !/(?:^|\s)(?:--help|-h|help|--version)\b/u.test(verificationCommand);
    const explicitTargets = goalEvidenceExplicitTargets(goalRequest);
    const evidenceText = `${detail} ${observationMeta} ${pairedCommand}`.toLowerCase();
    const targetRelevant =
      explicitTargets.length === 0 ||
      explicitTargets.some((target) => evidenceMatchesExplicitTarget(evidenceText, target));
    if (
      isConfigObservation &&
      !readOnlyAction &&
      Boolean(actionFingerprint) &&
      resultDigest &&
      postStateDigest &&
      targetRelevant
    ) {
      trustedObservationEvidence.push({
        id: `config.mutation:${digest}`,
        kind: "config_mutation",
        summary: `controller observed successful configuration mutation ${detail}`.slice(0, 2_048),
        resultDigest,
        postStateDigest,
      });
    } else if (isConfigObservation) {
      trustedObservationEvidence.push({
        id: `config.observation:${digest}`,
        kind: "config_observation",
        summary: `controller observed configuration read ${detail}`.slice(0, 2_048),
      });
    } else if (isFileMutation && resultDigest && postStateDigest && targetRelevant) {
      trustedObservationEvidence.push({
        id: `source.mutation:${digest}`,
        kind: "source_mutation",
        summary: `controller observed successful source mutation ${detail}`.slice(0, 2_048),
        resultDigest,
        postStateDigest,
      });
    } else if (isTestExecution && resultDigest && targetRelevant) {
      trustedObservationEvidence.push({
        id: `test.execution:${digest}`,
        kind: "test_execution",
        summary: `controller observed successful test or verification command ${detail}`.slice(
          0,
          2_048,
        ),
        resultDigest,
      });
    } else if (path || oldpath || normalizedTool === "read") {
      trustedObservationEvidence.push({
        id: `source.observation:${digest}`,
        kind: "source_observation",
        summary: `controller observed source read ${detail}`.slice(0, 2_048),
      });
    }
  }
  const uniqueObservationEvidence = [
    ...new Map(trustedObservationEvidence.map((record) => [record.id, record] as const)).values(),
  ].toSorted((a, b) => {
    const priority = (kind: JudgeTrustedEvidence["kind"]) =>
      kind === "source_mutation" || kind === "config_mutation" || kind === "test_execution" ? 0 : 1;
    return priority(a.kind) - priority(b.kind) || a.id.localeCompare(b.id);
  });
  const observationBudget = Math.max(
    0,
    32 - 1 - (trace || toolSummary ? 1 : 0) - Math.min(artifactIds.length, 32),
  );
  const trustedEvidence: JudgeTrustedEvidence[] = [
    {
      id: "runtime.completion",
      kind: "runtime_completion",
      summary: "controller observed worker goal status=complete and a returned result",
    },
  ];
  trustedEvidence.push(...uniqueObservationEvidence.slice(0, observationBudget));
  if (trace || toolSummary) {
    const successfulToolExecution = calls > 0 && failures === 0;
    if (successfulToolExecution) {
      trustedEvidence.push({
        id: "worker.execution",
        kind: "worker_execution",
        summary: `controller observed successful runtime=${runner}, toolCalls=${calls}, toolFailures=0`,
      });
    }
  }
  for (const artifactId of artifactIds) {
    trustedEvidence.push({
      id: artifactId,
      kind: "artifact_digest",
      summary: "controller loaded and hashed the referenced artifact bytes",
    });
  }
  return {
    summary: observations.join("; "),
    trustedEvidence,
  };
}

function assistantMessageText(result: AssistantMessage): string {
  return result.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .trim();
}

function directJudgeModelIdentity(result: AssistantMessage): string {
  return `${result.provider}/${result.responseModel ?? result.model}`;
}

function isTrustedHostedJudgeEndpoint(model: {
  provider: string;
  api: string;
  baseUrl?: string;
}): boolean {
  if (model.provider !== "openai" || !model.baseUrl?.trim()) {
    return false;
  }
  return model.api === "openai-responses"
    ? /^https:\/\/api\.openai\.com(?:\/v1)?\/?$/iu.test(model.baseUrl)
    : model.api === "openai-chatgpt-responses"
      ? /^https:\/\/chatgpt\.com\/backend-api(?:\/codex)?(?:\/v1)?\/?$/iu.test(model.baseUrl)
      : false;
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
  localAdmissionHeld?: boolean;
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
  if (params.route === "local" && !isJudgeLocalProvider(selection.provider, params.cfg)) {
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
    skipProviderRuntimeAuth: true,
  });
  if ("error" in prepared) {
    return failedDirectJudgeResult({
      agentId: params.agentId,
      model: requestedModel,
      reason: "model preparation failed",
      route: params.route,
    });
  }
  if (
    params.route === "local" &&
    !isJudgePreparedLocalModel({ config: params.cfg, model: prepared.model })
  ) {
    return failedDirectJudgeResult({
      agentId: params.agentId,
      model: requestedModel,
      reason: "local Judge provider or endpoint is not explicitly trusted",
      route: params.route,
    });
  }
  let physicalRequestCount = 0;
  let model =
    params.route === "local"
      ? prepareModelForSimpleCompletion({ model: prepared.model, cfg: params.cfg })
      : prepared.model;
  model =
    params.route === "local" && params.localAdmissionHeld
      ? markLocalInferenceAdmissionHeld(model)
      : model;
  model = markJudgeTransportModel(model, () => {
    if (physicalRequestCount >= JUDGE_MODEL_REQUEST_COUNT) {
      throw new Error("Judge transport attempted more than one physical request");
    }
    physicalRequestCount += 1;
  });
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
  if (params.route === "hosted" && !isTrustedHostedJudgeEndpoint(model)) {
    return failedDirectJudgeResult({
      agentId: params.agentId,
      model: requestedModel,
      reason: "hosted Judge endpoint is not an official OpenAI or ChatGPT endpoint",
      route: params.route,
    });
  }

  let requestPrepared = false;
  let modelVisibleTools: string[] = [];
  let response: AssistantMessage;
  try {
    const completeModel = params.route === "hosted" ? completeJudgeSimple : completeSimple;
    response = await completeModel(
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
      requestCount: physicalRequestCount,
      route: params.route,
    });
  }

  const responseToolNames = [
    ...(response.responseOutputItems ?? []).map((item) => `response-item:${item}`),
    ...response.content.flatMap((block) =>
      block.type === "toolCall" ? [block.name.trim() || "unknown-tool"] : [],
    ),
  ];
  modelVisibleTools = [...new Set([...modelVisibleTools, ...responseToolNames])];
  const modelIdentity = directJudgeModelIdentity(response);
  if (
    !response.responseModel?.trim() ||
    response.responseModel.trim() !== model.id ||
    modelIdentity !== requestedModel ||
    (params.route === "hosted" && response.provider !== "openai")
  ) {
    modelVisibleTools = [
      ...new Set([
        ...modelVisibleTools,
        response.responseModel?.trim() ? "model-identity-drift" : "model-identity-unobserved",
      ]),
    ];
  }
  return {
    text:
      response.stopReason === "stop"
        ? assistantMessageText(response)
        : "Judge provider returned an error.",
    runId: `judge-${params.route}-${crypto.randomUUID()}`,
    agentId: params.agentId,
    model: modelIdentity,
    executionEvidence: {
      requestCount: physicalRequestCount,
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

export async function runIndependentJudge(params: {
  input: PursueGoalTurnInput;
  finalText: string;
  evidenceSummary: string;
  artifactIds: string[];
  trustedEvidence: readonly JudgeTrustedEvidence[];
}) {
  const cfg = getRuntimeConfig();
  const judgeAgentId = resolveJudgeAgentId(cfg);
  return await judgeCompletionIndependently({
    missionId: params.input.state.missionId,
    requestBody: params.input.goal,
    finalText: params.finalText,
    evidenceSummary: params.evidenceSummary,
    artifactIds: params.artifactIds,
    trustedEvidence: params.trustedEvidence,
    beforeModel: params.input.reserveJudgeExecution,
    runModel: judgeAgentId
      ? async (prompt) => {
          const candidates = resolveJudgeModelCandidates(cfg, judgeAgentId);
          let lastFailure: Awaited<ReturnType<typeof runDirectJudgeModel>> | undefined;
          for (const [index, candidate] of candidates.entries()) {
            let release: (() => void) | undefined;
            if (candidate.route === "local") {
              const capacity = await assessJudgeLocalCapacity({
                config: cfg,
                selectedModel: candidate.ref,
                requireImmutableIdentity: true,
              });
              if (capacity.decision === "hosted_fallback") {
                continue;
              }
              const admission = await acquireLocalInferenceAdmission({
                ownerId: params.input.flowId,
                timeoutMs: index === 0 ? JUDGE_LOCAL_PRIMARY_WAIT_MS : JUDGE_LOCAL_BACKUP_WAIT_MS,
                signal: params.input.abortSignal,
                priority: "judge",
              });
              if (!admission.admitted) {
                continue;
              }
              release = admission.release;
              const recheck = await assessJudgeLocalCapacity({
                config: cfg,
                selectedModel: candidate.ref,
                leaseHeld: true,
                requireImmutableIdentity: true,
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
                localAdmissionHeld: candidate.route === "local",
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
              const parsed = parseJudgeV2ModelOutput(result.text);
              const expectedEvidence = judgeTrustedEvidenceReferenceList(params.trustedEvidence);
              const returnedEvidence = parsed.ok
                ? parsed.value.evidence
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean)
                    .toSorted()
                    .join(", ")
                : "";
              const validApprovalShape =
                parsed.ok &&
                (parsed.value.verdict !== "APPROVE" ||
                  (parsed.value.scope.trim() === "exact Pursue Goal mission" &&
                    (parsed.value.risk === "low" || parsed.value.risk === "medium") &&
                    parsed.value.conditions.trim().toLowerCase() === "none" &&
                    returnedEvidence === expectedEvidence));
              if (
                !parsed.ok ||
                !validApprovalShape ||
                result.executionEvidence.modelVisibleTools.length
              ) {
                lastFailure = result;
                // The Judge contract signs the physical request count for the
                // returned candidate. Once a provider request was prepared,
                // another candidate would make the final receipt under-report
                // execution and could duplicate a side effect. Only fall back
                // when the candidate failed before any provider request.
                if (result.executionEvidence.requestCount > 0) {
                  return result;
                }
                continue;
              }
              return result;
            } finally {
              release?.();
            }
          }
          return (
            lastFailure ??
            failedDirectJudgeResult({
              agentId: judgeAgentId,
              model: "none",
              reason: "all explicit Judge candidates were unavailable before request start",
              route: "unknown",
            })
          );
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
    const observedEvidence = collectObservedWorkerEvidence(result, artifactIds, input.goal);
    const judge = await runIndependentJudge({
      input,
      finalText: text,
      evidenceSummary: observedEvidence.summary,
      artifactIds,
      trustedEvidence: observedEvidence.trustedEvidence,
    });
    return {
      status: judge.approved ? "complete" : "blocked",
      text,
      artifactIds,
      evidenceSummary: observedEvidence.summary,
      trustedEvidence: [...observedEvidence.trustedEvidence],
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

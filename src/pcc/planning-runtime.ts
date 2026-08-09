import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  resolveDefaultAgentId,
  resolveAgentDir,
  resolveAgentWorkspaceDir,
} from "../agents/agent-scope.js";
import { runEmbeddedAgent } from "../agents/embedded-agent.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  assertPccPlanningAuthorized,
  buildPccPlanningPrompt,
  CODEX_PCC_PLANNING_POLICY,
  DEFAULT_PCC_PLANNING_POLICY,
  parsePccPlanGenerationResult,
  resolvePccPlanningEffort,
  type PccPlanGenerationRequest,
  type PccPlanGenerationResult,
  type PccPlanningPolicy,
} from "./planning.js";

type EmbeddedPlannerResult = Awaited<ReturnType<typeof runEmbeddedAgent>>;

export type PccPlannerRunner = (
  params: Parameters<typeof runEmbeddedAgent>[0],
) => Promise<EmbeddedPlannerResult>;

export type PccModelUsage = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
};

function normalizedUsage(
  usage: NonNullable<EmbeddedPlannerResult["meta"]["agentMeta"]>["usage"],
): PccModelUsage | undefined {
  if (!usage) {
    return undefined;
  }
  const finiteCount = (value: number | undefined) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0
      ? Math.floor(value)
      : undefined;
  const normalized = {
    input: finiteCount(usage.input),
    output: finiteCount(usage.output),
    cacheRead: finiteCount(usage.cacheRead),
    cacheWrite: finiteCount(usage.cacheWrite),
    totalTokens: finiteCount(usage.total),
  };
  return Object.values(normalized).some((value) => value !== undefined) ? normalized : undefined;
}

function payloadText(result: EmbeddedPlannerResult): string {
  return (
    result.payloads
      ?.map((payload) => payload.text)
      .filter((text): text is string => Boolean(text?.trim()))
      .join("\n")
      .trim() ?? ""
  );
}

function safePlannerError(error: unknown, policy: PccPlanningPolicy): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/auth|oauth|401|unauthorized|login|sign.?in/iu.test(message)) {
    return policy.runtime === "codex"
      ? new Error(
          "Codex planning needs OpenAI OAuth. Sign in with `openclaw models auth login --provider openai`, then retry.",
        )
      : new Error(
          `Local AI planning needs the configured ${policy.model} model. Confirm the local model service is running, then retry.`,
        );
  }
  if (/unknown model|model.*unavailable|not found/iu.test(message)) {
    return policy.runtime === "codex"
      ? new Error(
          "GPT-5.6 Sol is not available to this OpenAI OAuth account. Refresh the model catalog or choose an available Codex planner.",
        )
      : new Error(
          `The local planning model ${policy.model} is unavailable. Refresh the local model catalog or choose another configured local model.`,
        );
  }
  return new Error(
    `${policy.runtime === "codex" ? "Codex" : "Local AI"} could not generate the project plan: ${message.slice(0, 400)}`,
  );
}

export async function generatePccPlan(params: {
  cfg: OpenClawConfig;
  request: PccPlanGenerationRequest;
  policy?: PccPlanningPolicy;
  runAgent?: PccPlannerRunner;
  now?: () => Date;
  abortSignal?: AbortSignal;
  onStage?: (stage: "preparing" | "planner_running" | "validating") => void | Promise<void>;
  onUsage?: (usage: PccModelUsage) => void | Promise<void>;
}): Promise<PccPlanGenerationResult> {
  await params.onStage?.("preparing");
  const policy = params.policy ?? DEFAULT_PCC_PLANNING_POLICY;
  assertPccPlanningAuthorized(params.request, policy);
  const effort = resolvePccPlanningEffort(params.request, policy);
  const agentId = resolveDefaultAgentId(params.cfg);
  const workspaceDir = resolveAgentWorkspaceDir(params.cfg, agentId);
  const agentDir = resolveAgentDir(params.cfg, agentId);
  const runId = `pcc-plan-${randomUUID()}`;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-pcc-plan-"));
  const sessionFile = path.join(tempDir, `${runId}.jsonl`);
  try {
    const runner = params.runAgent ?? runEmbeddedAgent;
    await params.onStage?.("planner_running");
    const result = await runner({
      sessionId: runId,
      sessionKey: `agent:${agentId}:pcc-planner:${runId}`,
      agentId,
      trigger: "manual",
      sessionFile,
      workspaceDir,
      agentDir,
      config: params.cfg,
      provider: policy.provider,
      model: policy.model.replace(/^(?:openai|ollama)\//u, ""),
      agentHarnessRuntimeOverride: policy.runtime,
      prompt: buildPccPlanningPrompt(params.request),
      disableTools: true,
      thinkLevel: effort,
      verboseLevel: "off",
      fastMode: false,
      timeoutMs: 180_000,
      runId,
      bootstrapContextMode: "lightweight",
      skillsSnapshot: { prompt: "", skills: [] },
      suppressToolErrorWarnings: true,
      cleanupBundleMcpOnRunEnd: true,
      authProfileFailurePolicy: "local",
      abortSignal: params.abortSignal,
    });
    const usage = normalizedUsage(result.meta?.agentMeta?.usage);
    if (usage) {
      await params.onUsage?.(usage);
    }
    const text = payloadText(result);
    if (!text) {
      throw new Error("The planner returned no project-plan content.");
    }
    const firstError = result.payloads?.find((payload) => payload.isError);
    if (firstError) {
      throw new Error(firstError.text || "Project planning failed.");
    }
    await params.onStage?.("validating");
    return parsePccPlanGenerationResult({
      text,
      effort,
      policy,
      model: policy.model,
      generatedAt: (params.now ?? (() => new Date()))().toISOString(),
    });
  } catch (error) {
    throw safePlannerError(error, policy);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Backward-compatible explicit Codex entry point for tests and opt-in callers. */
export async function generatePccPlanWithCodex(params: {
  cfg: OpenClawConfig;
  request: PccPlanGenerationRequest;
  policy?: PccPlanningPolicy;
  runAgent?: PccPlannerRunner;
  now?: () => Date;
  abortSignal?: AbortSignal;
  onStage?: (stage: "preparing" | "planner_running" | "validating") => void | Promise<void>;
  onUsage?: (usage: PccModelUsage) => void | Promise<void>;
}): Promise<PccPlanGenerationResult> {
  return generatePccPlan({
    ...params,
    policy: params.policy ?? CODEX_PCC_PLANNING_POLICY,
  });
}

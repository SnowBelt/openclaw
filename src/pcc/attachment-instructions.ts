import { randomUUID } from "node:crypto";
import type { PccAttachment } from "../../packages/gateway-protocol/src/index.js";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import {
  completeWithPreparedSimpleCompletionModel,
  prepareSimpleCompletionModelForAgent,
} from "../agents/simple-completion-runtime.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { PccModelUsage } from "./planning-runtime.js";

const LOCAL_PROVIDERS = new Set(["ollama", "lmstudio", "llama.cpp", "llamacpp", "vllm", "local"]);

function modelUsesLocalTransport(model: { provider: string; baseUrl?: string }): boolean {
  if (LOCAL_PROVIDERS.has(model.provider.toLowerCase())) {
    return true;
  }
  if (!model.baseUrl) {
    return false;
  }
  try {
    const host = new URL(model.baseUrl).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

export async function clarifyPccAttachmentInstructions(params: {
  cfg: OpenClawConfig;
  originalName: string;
  role: PccAttachment["role"];
  instructions: string;
  prepare?: typeof prepareSimpleCompletionModelForAgent;
  complete?: typeof completeWithPreparedSimpleCompletionModel;
  now?: () => Date;
}): Promise<{
  runId: string;
  clarifiedInstructions: string;
  provenance: { provider: string; model: string; generatedAt: string };
  usage?: PccModelUsage;
}> {
  const instructions = params.instructions.trim();
  if (!instructions) {
    throw new Error("Describe how PCC should use the file before asking local AI to clarify it");
  }
  const agentId = resolveDefaultAgentId(params.cfg);
  const prepared = await (params.prepare ?? prepareSimpleCompletionModelForAgent)({
    cfg: params.cfg,
    agentId,
    useUtilityModel: true,
    allowBundledStaticCatalogFallback: true,
    skipAgentDiscovery: true,
  });
  if ("error" in prepared) {
    throw new Error(`Local AI is unavailable: ${prepared.error}`);
  }
  const baseUrl =
    "baseUrl" in prepared.model && typeof prepared.model.baseUrl === "string"
      ? prepared.model.baseUrl
      : undefined;
  if (!modelUsesLocalTransport({ provider: prepared.model.provider, baseUrl })) {
    throw new Error(
      "The configured utility model is not local. Choose a local utility model before clarifying file instructions.",
    );
  }
  const result = await (params.complete ?? completeWithPreparedSimpleCompletionModel)({
    cfg: params.cfg,
    model: prepared.model,
    auth: prepared.auth,
    context: {
      systemPrompt:
        "Rewrite the operator's rough file-use note as one concise, unambiguous instruction. Preserve intent. State what the file is for, where it applies, what to extract or avoid, and how success will be checked. Do not invent requirements. Return only the improved instruction.",
      messages: [
        {
          role: "user",
          content: `File: ${params.originalName}\nRole: ${params.role}\nRough instruction: ${instructions}`,
          timestamp: Date.now(),
        },
      ],
    },
    options: { maxTokens: 500, temperature: 0.2, timeoutMs: 45_000 },
  });
  const clarifiedInstructions = result.content
    .filter((entry): entry is { type: "text"; text: string } => entry.type === "text")
    .map((entry) => entry.text)
    .join("")
    .trim();
  if (!clarifiedInstructions) {
    throw new Error("The local model returned no clarified file instruction");
  }
  const usage: PccModelUsage = {
    input: result.usage.input,
    output: result.usage.output,
    cacheRead: result.usage.cacheRead,
    cacheWrite: result.usage.cacheWrite,
    totalTokens: result.usage.totalTokens,
  };
  const hasReportedUsage = Object.values(usage).some(
    (value) => typeof value === "number" && Number.isFinite(value) && value >= 0,
  );
  return {
    runId: `pcc-attachment-clarification-${randomUUID()}`,
    clarifiedInstructions,
    ...(hasReportedUsage ? { usage } : {}),
    provenance: {
      provider: prepared.selection.provider,
      model: prepared.selection.modelId,
      generatedAt: (params.now ?? (() => new Date()))().toISOString(),
    },
  };
}

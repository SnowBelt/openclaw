// Explicit, non-inheriting model candidates for the independent Judge.
import { isIP } from "node:net";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { Model } from "../llm/types.js";
import {
  resolveAgentExplicitModelPrimary,
  resolveAgentModelFallbacksOverride,
} from "./agent-scope.js";
import { JUDGE_HOSTED_MODEL } from "./judge-contract.js";

export type JudgeModelCandidate = {
  ref: string;
  route: "local" | "hosted";
};

const LOCAL_PROVIDER_NAMES = new Set(["ollama", "omlx"]);
const LOCAL_MODEL_APIS = new Set<string>(["ollama", "openai-completions"]);

function isPrivateLocalEndpoint(baseUrl: string | undefined): boolean {
  if (!baseUrl?.trim()) {
    return false;
  }
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
    if (hostname === "localhost" || hostname.endsWith(".local")) {
      return true;
    }
    const version = isIP(hostname);
    if (version === 6) {
      return hostname === "::1" || hostname.startsWith("fc") || hostname.startsWith("fd");
    }
    if (version !== 4) {
      return false;
    }
    const octets = hostname.split(".").map(Number);
    return (
      octets[0] === 10 ||
      octets[0] === 127 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168)
    );
  } catch {
    return false;
  }
}

/**
 * Local providers may be deployment-named (for example `omlx-qwen38-judge`),
 * but a custom id is admitted only when its config explicitly declares a
 * local route and a private endpoint. Provider names alone are not trust.
 */
export function isJudgeLocalProvider(provider: string, config?: OpenClawConfig): boolean {
  const normalized = provider.trim().toLowerCase();
  const configured =
    config?.models?.providers?.[provider] ??
    Object.entries(config?.models?.providers ?? {}).find(
      ([key]) => key.trim().toLowerCase() === normalized,
    )?.[1];
  if (configured) {
    return (
      configured.route?.location === "local" &&
      LOCAL_MODEL_APIS.has(configured.api ?? "openai-completions") &&
      isPrivateLocalEndpoint(configured.baseUrl)
    );
  }
  // Ollama's built-in provider has a known loopback default. OMLX does not;
  // it must provide an explicit local endpoint before any probe is allowed.
  if (normalized === "ollama") {
    return true;
  }
  if (LOCAL_PROVIDER_NAMES.has(normalized)) {
    return false;
  }
  return false;
}

/** Revalidates the prepared provider/model boundary before local inference. */
export function isJudgePreparedLocalModel(params: {
  config: OpenClawConfig;
  model: Pick<Model, "provider" | "api" | "baseUrl">;
}): boolean {
  if (!isJudgeLocalProvider(params.model.provider, params.config)) {
    return false;
  }
  if (!LOCAL_MODEL_APIS.has(params.model.api)) {
    return false;
  }
  if (!isPrivateLocalEndpoint(params.model.baseUrl)) {
    return false;
  }
  const configured = params.config.models?.providers?.[params.model.provider];
  return (
    configured?.route?.location !== "remote" &&
    (configured?.api === undefined || configured.api === params.model.api)
  );
}

export function resolveJudgeModelCandidates(
  config: OpenClawConfig,
  agentId: string,
): JudgeModelCandidate[] {
  const primary = resolveAgentExplicitModelPrimary(config, agentId)?.trim();
  if (!primary) {
    return [];
  }
  const configured = [primary, ...(resolveAgentModelFallbacksOverride(config, agentId) ?? [])];
  const seen = new Set<string>();
  return configured.reduce<JudgeModelCandidate[]>((candidates, value) => {
    const ref = value.trim();
    if (!ref || seen.has(ref)) {
      return candidates;
    }
    seen.add(ref);
    if (ref === JUDGE_HOSTED_MODEL) {
      candidates.push({ ref, route: "hosted" });
      return candidates;
    }
    const provider = ref.slice(0, ref.indexOf("/"));
    if (provider && isJudgeLocalProvider(provider, config)) {
      candidates.push({ ref, route: "local" });
    }
    return candidates;
  }, []);
}

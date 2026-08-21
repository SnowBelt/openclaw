// Explicit, non-inheriting model candidates for the independent Judge.
import type { OpenClawConfig } from "../config/types.openclaw.js";
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

/** Local providers may be deployment-named (for example `omlx-qwen38-judge`). */
export function isJudgeLocalProvider(provider: string): boolean {
  const normalized = provider.trim().toLowerCase();
  return (
    LOCAL_PROVIDER_NAMES.has(normalized) ||
    normalized.startsWith("ollama-") ||
    normalized.startsWith("omlx-")
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
    if (provider && isJudgeLocalProvider(provider)) {
      candidates.push({ ref, route: "local" });
    }
    return candidates;
  }, []);
}

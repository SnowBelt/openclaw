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

const LOCAL_PROVIDER_PREFIXES = ["ollama/", "omlx/"] as const;

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
    if (LOCAL_PROVIDER_PREFIXES.some((prefix) => ref.startsWith(prefix))) {
      candidates.push({ ref, route: "local" });
    }
    return candidates;
  }, []);
}

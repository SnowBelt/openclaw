// Readiness-only audit that proves configured tool policy does not contradict an operational role.
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { resolveAgentRoleCapabilityContract } from "./agent-role-capabilities.js";
import { resolveAgentConfig } from "./agent-scope.js";
import { resolveEffectiveToolPolicy } from "./agent-tools.policy.js";
import { isToolAllowedByPolicies } from "./tool-policy-match.js";
import { mergeAlsoAllowPolicy, resolveToolProfilePolicy } from "./tool-policy.js";

export type AgentRoleCapabilityPolicyAudit = {
  agentId: string;
  role: "program_manager" | "judge";
  requiredTools: string[];
  missingTools: string[];
  passed: boolean;
};

function selectedModelRef(config: OpenClawConfig, agentId: string): string | undefined {
  const model = resolveAgentConfig(config, agentId)?.model;
  return typeof model === "string" ? model : model?.primary;
}

function modelParts(modelRef: string | undefined): { modelProvider?: string; modelId?: string } {
  const separator = modelRef?.indexOf("/") ?? -1;
  return separator > 0
    ? { modelProvider: modelRef!.slice(0, separator), modelId: modelRef!.slice(separator + 1) }
    : { modelId: modelRef };
}

/**
 * Runtime role budgets can narrow an over-broad config, but they cannot restore a tool that an
 * operator profile or deny rule removed. Audit only that required intersection so explicit
 * operator denials continue to win and readiness fails instead of advertising dead delegation.
 */
export function auditOperationalRoleCapabilityPolicy(params: {
  config: OpenClawConfig;
  agentId: string;
}): AgentRoleCapabilityPolicyAudit | undefined {
  const contract = resolveAgentRoleCapabilityContract(params);
  if (contract?.role !== "program_manager" && contract?.role !== "judge") {
    return undefined;
  }
  const effective = resolveEffectiveToolPolicy({
    config: params.config,
    agentId: params.agentId,
    ...modelParts(selectedModelRef(params.config, params.agentId)),
  });
  const policies = [
    mergeAlsoAllowPolicy(resolveToolProfilePolicy(effective.profile), effective.profileAlsoAllow),
    mergeAlsoAllowPolicy(
      resolveToolProfilePolicy(effective.providerProfile),
      effective.providerProfileAlsoAllow,
    ),
    effective.globalPolicy,
    effective.globalProviderPolicy,
    effective.agentPolicy,
    effective.agentProviderPolicy,
  ];
  const missingTools = contract.toolsAllow.filter(
    (toolName) => !isToolAllowedByPolicies(toolName, policies),
  );
  return {
    agentId: params.agentId,
    role: contract.role,
    requiredTools: contract.toolsAllow,
    missingTools,
    passed: missingTools.length === 0,
  };
}

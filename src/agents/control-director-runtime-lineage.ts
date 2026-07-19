// Runtime-owned Control Director lineage derived from the managed snapshot, never cwd.
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { GatewayRuntimeSnapshotProvenance } from "../daemon/gateway-runtime-snapshot.js";
import { resolveAgentRoleCapabilityContract } from "./agent-role-capabilities.js";
import { buildControlDirectorModelRegistry } from "./control-director-model-registry.js";
import { resolveConfiguredControlDirectorAgent } from "./control-director-role.js";
import {
  captureControlDirectorRuntimeCanary,
  type ControlDirectorRuntimeCanary,
} from "./control-director-runtime-canary.js";

export const CONTROL_DIRECTOR_RUNTIME_LINEAGE_VERSION = 1 as const;
export const CONTROL_DIRECTOR_MEMORY_BUILD_ID = "control-director-memory-index-v1";

export type ControlDirectorRuntimeLineage = {
  schemaVersion: typeof CONTROL_DIRECTOR_RUNTIME_LINEAGE_VERSION;
  status: "ready" | "blocked";
  checkedAt: number;
  agentId: string;
  role: "control_director";
  selectedModel?: string;
  sourceSha?: string;
  runtimeVersion: string;
  releaseId?: string;
  artifactHash?: string;
  canary?: ControlDirectorRuntimeCanary;
  blockers: string[];
};

function immutableSha(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[a-f0-9]{40}$/u.test(normalized) ? normalized : undefined;
}

/**
 * Build exact runtime lineage only from the active config and managed snapshot provenance.
 * Missing provenance blocks readiness instead of falling back to a source checkout cwd.
 */
export function buildControlDirectorRuntimeLineage(params: {
  config: OpenClawConfig;
  agentId: string;
  runtimeVersion: string;
  provenance: GatewayRuntimeSnapshotProvenance | null;
  expectedSourceSha?: string;
  checkedAt?: number;
}): ControlDirectorRuntimeLineage | undefined {
  const agent = resolveConfiguredControlDirectorAgent(params.config, params.agentId);
  if (agent?.role !== "control_director") {
    return undefined;
  }
  const checkedAt = params.checkedAt ?? Date.now();
  const registry = buildControlDirectorModelRegistry({
    config: params.config,
    agentId: params.agentId,
  });
  const sourceSha = immutableSha(params.provenance?.sourceCommit);
  const expectedSourceSha = immutableSha(params.expectedSourceSha);
  const artifactHash = params.provenance?.artifactHash;
  const blockers: string[] = [];
  if (registry.selected.status !== "ready") {
    blockers.push(registry.selected.reason);
  }
  if (!params.provenance) {
    blockers.push("Managed Gateway runtime snapshot provenance is unavailable.");
  }
  if (!sourceSha) {
    blockers.push("Managed Gateway runtime provenance has no immutable source SHA.");
  }
  if (!artifactHash) {
    blockers.push("Managed Gateway runtime provenance has no artifact hash.");
  }
  if (expectedSourceSha && sourceSha && expectedSourceSha !== sourceSha) {
    blockers.push(`Managed source SHA ${sourceSha} does not match expected ${expectedSourceSha}.`);
  }

  const selectedModel =
    registry.selected.status === "ready" ? registry.selected.effective : undefined;
  let canary: ControlDirectorRuntimeCanary | undefined;
  if (blockers.length === 0 && sourceSha && artifactHash && selectedModel) {
    const capabilities = resolveAgentRoleCapabilityContract({
      config: params.config,
      agentId: params.agentId,
    });
    canary = captureControlDirectorRuntimeCanary({
      config: params.config,
      agentId: params.agentId,
      sourceSha,
      runtimeVersion: params.runtimeVersion,
      tools: capabilities?.toolsAllow ?? [],
      skills: agent.skills ?? [],
      memoryBuildId: CONTROL_DIRECTOR_MEMORY_BUILD_ID,
      uiBuildId: artifactHash,
      capturedAt: checkedAt,
    });
  }
  return {
    schemaVersion: CONTROL_DIRECTOR_RUNTIME_LINEAGE_VERSION,
    status: blockers.length === 0 && canary ? "ready" : "blocked",
    checkedAt,
    agentId: params.agentId,
    role: "control_director",
    ...(selectedModel ? { selectedModel } : {}),
    ...(sourceSha ? { sourceSha } : {}),
    runtimeVersion: params.runtimeVersion.trim() || "unknown",
    ...(params.provenance?.releaseId ? { releaseId: params.provenance.releaseId } : {}),
    ...(artifactHash ? { artifactHash } : {}),
    ...(canary ? { canary } : {}),
    blockers,
  };
}

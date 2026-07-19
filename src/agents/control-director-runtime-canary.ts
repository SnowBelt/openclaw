// Exact-config Control Director canary manifest and fail-closed replay comparison.
import { createHash } from "node:crypto";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { buildControlDirectorModelRegistry } from "./control-director-model-registry.js";
import { resolveConfiguredControlDirectorAgent } from "./control-director-role.js";
import { compileControlDirectorTurnPolicy } from "./control-director-turn-policy.js";

export const CONTROL_DIRECTOR_RUNTIME_CANARY_VERSION = 1 as const;

export type ControlDirectorRuntimeCanary = {
  schemaVersion: typeof CONTROL_DIRECTOR_RUNTIME_CANARY_VERSION;
  capturedAt: number;
  sourceSha: string;
  runtimeVersion: string;
  configHash: string;
  agentId: string;
  role: "control_director";
  selectedModel: string;
  modelRegistryHash: string;
  promptHash: string;
  toolsHash: string;
  skillsHash: string;
  memoryBuildId: string;
  uiBuildId: string;
};

export type ControlDirectorRuntimeReplayResult = {
  status: "passed" | "failed";
  mismatches: Array<{
    field: keyof ControlDirectorRuntimeCanary;
    expected: string;
    actual: string;
  }>;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

function digest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function requireSourceSha(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(normalized)) {
    throw new Error("Control Director canary requires an immutable 40-character source SHA.");
  }
  return normalized;
}

/** Capture hashes of the exact identity, model, prompt, tools, skills, memory, and UI. */
export function captureControlDirectorRuntimeCanary(params: {
  config: OpenClawConfig;
  agentId: string;
  sourceSha: string;
  runtimeVersion: string;
  tools: readonly string[];
  skills: readonly string[];
  memoryBuildId: string;
  uiBuildId: string;
  capturedAt?: number;
}): ControlDirectorRuntimeCanary {
  const configured = resolveConfiguredControlDirectorAgent(params.config, params.agentId);
  if (configured?.role !== "control_director") {
    throw new Error(`Agent ${params.agentId} is not configured with role control_director.`);
  }
  const registry = buildControlDirectorModelRegistry({
    config: params.config,
    agentId: params.agentId,
  });
  if (registry.selected.status !== "ready") {
    throw new Error(registry.selected.reason);
  }
  const policy = compileControlDirectorTurnPolicy({
    config: params.config,
    agentId: params.agentId,
    requestText: "Report exact runtime canary status.",
    explicitMode: "status",
    upstreamToolsAllow: params.tools,
  });
  if (!policy) {
    throw new Error("Control Director policy compiler did not admit the configured agent.");
  }
  return {
    schemaVersion: CONTROL_DIRECTOR_RUNTIME_CANARY_VERSION,
    capturedAt: params.capturedAt ?? Date.now(),
    sourceSha: requireSourceSha(params.sourceSha),
    runtimeVersion: params.runtimeVersion.trim(),
    configHash: digest(params.config),
    agentId: params.agentId,
    role: "control_director",
    selectedModel: registry.selected.effective,
    modelRegistryHash: digest(registry),
    promptHash: digest(policy.prompt),
    toolsHash: digest([...params.tools].toSorted()),
    skillsHash: digest([...params.skills].toSorted()),
    memoryBuildId: params.memoryBuildId.trim(),
    uiBuildId: params.uiBuildId.trim(),
  };
}

/** Replay passes only when every operational field matches the captured manifest. */
export function compareControlDirectorRuntimeCanary(
  expected: ControlDirectorRuntimeCanary,
  actual: ControlDirectorRuntimeCanary,
): ControlDirectorRuntimeReplayResult {
  const fields: Array<keyof ControlDirectorRuntimeCanary> = [
    "schemaVersion",
    "sourceSha",
    "runtimeVersion",
    "configHash",
    "agentId",
    "role",
    "selectedModel",
    "modelRegistryHash",
    "promptHash",
    "toolsHash",
    "skillsHash",
    "memoryBuildId",
    "uiBuildId",
  ];
  const mismatches = fields.flatMap((field) =>
    expected[field] === actual[field]
      ? []
      : [{ field, expected: String(expected[field]), actual: String(actual[field]) }],
  );
  return { status: mismatches.length === 0 ? "passed" : "failed", mismatches };
}

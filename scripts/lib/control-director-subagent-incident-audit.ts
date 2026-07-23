import path from "node:path";

export const CONTROL_DIRECTOR_SUBAGENT_INCIDENT_CODES = [
  "native_spawn_cwd_dropped",
  "task_root_outside_effective_workspace",
  "worker_discovery_tool_unavailable",
  "explicit_self_spawn",
  "role_mutation_contract_conflict",
  "unsupported_completion_claim",
] as const;

export type ControlDirectorSubagentIncidentCode =
  (typeof CONTROL_DIRECTOR_SUBAGENT_INCIDENT_CODES)[number];

export type ControlDirectorSubagentIncidentObservation = {
  scenarioId: string;
  runtime?: "subagent" | "acp";
  requestedCwd?: string;
  forwardedCwd?: string;
  requestedTaskPath?: string;
  effectiveWorkspaceRoots?: string[];
  recommendedWorkerDiscoveryTool?: string;
  effectiveTools?: string[];
  requesterAgentId?: string;
  requestedAgentId?: string;
  requestedAgentIdWasExplicit?: boolean;
  roleRequiresMutation?: boolean;
  mutationCapabilityAllowed?: boolean;
  completionClaimed?: boolean;
  evidenceRefs?: string[];
};

export type ControlDirectorSubagentIncidentFinding = {
  scenarioId: string;
  code: ControlDirectorSubagentIncidentCode;
  severity: "critical" | "high";
  summary: string;
  evidenceRefs: string[];
};

export type ControlDirectorSubagentIncidentScenario = {
  id: string;
  expectedCode: ControlDirectorSubagentIncidentCode;
  observation: ControlDirectorSubagentIncidentObservation;
};

const INCIDENT_METADATA: Record<
  ControlDirectorSubagentIncidentCode,
  Pick<ControlDirectorSubagentIncidentFinding, "severity" | "summary" | "evidenceRefs">
> = {
  native_spawn_cwd_dropped: {
    severity: "critical",
    summary: "A native subagent spawn accepted a task cwd but did not forward it.",
    evidenceRefs: ["src/agents/tools/sessions-spawn-tool.ts", "src/agents/subagent-spawn.ts"],
  },
  task_root_outside_effective_workspace: {
    severity: "critical",
    summary: "The requested task path is outside every effective workspace root.",
    evidenceRefs: ["src/agents/subagent-spawn.ts", "src/agents/subagent-spawn.workspace.test.ts"],
  },
  worker_discovery_tool_unavailable: {
    severity: "high",
    summary: "Spawn guidance recommends a worker-discovery tool that is not available.",
    evidenceRefs: ["src/agents/subagent-spawn.ts", "src/agents/subagent-target-policy.ts"],
  },
  explicit_self_spawn: {
    severity: "high",
    summary: "An orchestrator explicitly targeted itself for a delegated child run.",
    evidenceRefs: ["src/agents/subagent-target-policy.ts", "src/agents/subagent-spawn.ts"],
  },
  role_mutation_contract_conflict: {
    severity: "critical",
    summary: "A role was instructed to mutate work while its capability contract forbids mutation.",
    evidenceRefs: ["src/agents/agent-role-capabilities.ts", "src/agents/agent-operational-role.ts"],
  },
  unsupported_completion_claim: {
    severity: "critical",
    summary: "Completion was claimed without any concrete evidence reference.",
    evidenceRefs: [
      "src/agents/control-director-truth-evidence.ts",
      "src/agents/control-director-delivery-guards.ts",
    ],
  },
};

function normalized(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function nonEmpty(values: readonly string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

function pathIsWithinRoot(candidate: string, root: string): boolean {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedRoot = path.resolve(root);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function finding(
  scenarioId: string,
  code: ControlDirectorSubagentIncidentCode,
): ControlDirectorSubagentIncidentFinding {
  return { scenarioId, code, ...INCIDENT_METADATA[code] };
}

export function auditControlDirectorSubagentIncident(
  observation: ControlDirectorSubagentIncidentObservation,
): ControlDirectorSubagentIncidentFinding[] {
  const scenarioId = observation.scenarioId.trim() || "unnamed-scenario";
  const findings: ControlDirectorSubagentIncidentFinding[] = [];

  if (
    observation.runtime === "subagent" &&
    Boolean(observation.requestedCwd?.trim()) &&
    !observation.forwardedCwd?.trim()
  ) {
    findings.push(finding(scenarioId, "native_spawn_cwd_dropped"));
  }

  const taskPath = observation.requestedTaskPath?.trim();
  const workspaceRoots = nonEmpty(observation.effectiveWorkspaceRoots);
  if (
    taskPath &&
    workspaceRoots.length > 0 &&
    !workspaceRoots.some((root) => pathIsWithinRoot(taskPath, root))
  ) {
    findings.push(finding(scenarioId, "task_root_outside_effective_workspace"));
  }

  const recommendedTool = normalized(observation.recommendedWorkerDiscoveryTool);
  const effectiveTools = new Set(nonEmpty(observation.effectiveTools).map(normalized));
  if (recommendedTool && !effectiveTools.has(recommendedTool)) {
    findings.push(finding(scenarioId, "worker_discovery_tool_unavailable"));
  }

  if (
    observation.requestedAgentIdWasExplicit === true &&
    normalized(observation.requesterAgentId) !== "" &&
    normalized(observation.requesterAgentId) === normalized(observation.requestedAgentId)
  ) {
    findings.push(finding(scenarioId, "explicit_self_spawn"));
  }

  if (
    observation.roleRequiresMutation === true &&
    observation.mutationCapabilityAllowed === false
  ) {
    findings.push(finding(scenarioId, "role_mutation_contract_conflict"));
  }

  if (observation.completionClaimed === true && nonEmpty(observation.evidenceRefs).length === 0) {
    findings.push(finding(scenarioId, "unsupported_completion_claim"));
  }

  return findings;
}

export const CONTROL_DIRECTOR_SUBAGENT_INCIDENT_BASELINE_SCENARIOS: readonly ControlDirectorSubagentIncidentScenario[] =
  [
    {
      id: "native-cwd-not-forwarded",
      expectedCode: "native_spawn_cwd_dropped",
      observation: {
        scenarioId: "native-cwd-not-forwarded",
        runtime: "subagent",
        requestedCwd: "/private/tmp/project-worktree",
      },
    },
    {
      id: "task-root-outside-worker-workspace",
      expectedCode: "task_root_outside_effective_workspace",
      observation: {
        scenarioId: "task-root-outside-worker-workspace",
        requestedTaskPath: "/private/tmp/project-worktree",
        effectiveWorkspaceRoots: ["/Users/example/.openclaw/workspace-program-manager"],
      },
    },
    {
      id: "worker-discovery-guidance-unavailable",
      expectedCode: "worker_discovery_tool_unavailable",
      observation: {
        scenarioId: "worker-discovery-guidance-unavailable",
        recommendedWorkerDiscoveryTool: "agents_list",
        effectiveTools: ["sessions_spawn", "sessions_yield"],
      },
    },
    {
      id: "program-manager-explicit-self-spawn",
      expectedCode: "explicit_self_spawn",
      observation: {
        scenarioId: "program-manager-explicit-self-spawn",
        requesterAgentId: "program-manager",
        requestedAgentId: "program-manager",
        requestedAgentIdWasExplicit: true,
      },
    },
    {
      id: "program-manager-role-capability-conflict",
      expectedCode: "role_mutation_contract_conflict",
      observation: {
        scenarioId: "program-manager-role-capability-conflict",
        roleRequiresMutation: true,
        mutationCapabilityAllowed: false,
      },
    },
    {
      id: "control-director-unsupported-completion",
      expectedCode: "unsupported_completion_claim",
      observation: {
        scenarioId: "control-director-unsupported-completion",
        completionClaimed: true,
        evidenceRefs: [],
      },
    },
  ];

export function runControlDirectorSubagentIncidentBaseline(): {
  passed: boolean;
  scenarioCount: number;
  reproducedCount: number;
  results: Array<{
    scenarioId: string;
    expectedCode: ControlDirectorSubagentIncidentCode;
    detectedCodes: ControlDirectorSubagentIncidentCode[];
    reproduced: boolean;
    evidenceRefs: string[];
  }>;
} {
  const results = CONTROL_DIRECTOR_SUBAGENT_INCIDENT_BASELINE_SCENARIOS.map((scenario) => {
    const findings = auditControlDirectorSubagentIncident(scenario.observation);
    const detectedCodes = findings.map((entry) => entry.code);
    const reproduced = detectedCodes.length === 1 && detectedCodes[0] === scenario.expectedCode;
    return {
      scenarioId: scenario.id,
      expectedCode: scenario.expectedCode,
      detectedCodes,
      reproduced,
      evidenceRefs: findings.flatMap((entry) => entry.evidenceRefs),
    };
  });
  const reproducedCount = results.filter((result) => result.reproduced).length;
  return {
    passed: reproducedCount === results.length,
    scenarioCount: results.length,
    reproducedCount,
    results,
  };
}

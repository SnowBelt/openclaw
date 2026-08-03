import type { PccWorkflowTemplateId } from "./domain/workflow.js";

export const PCC_PLANNING_SCHEMA_VERSION = 1 as const;
export const PCC_CODEX_PLANNER_MODEL = "openai/gpt-5.6-sol" as const;
export const PCC_LOCAL_PLANNER_MODEL = "ollama/qwen3.5:4b" as const;

export type PccPlanningProvider = "openai" | "ollama";
export type PccPlanningRuntime = "codex" | "openclaw";
export type PccPlannerSelection = "local" | "codex";

export type PccPlanningEffort = "medium" | "high";
export type PccPlanningDepth = "automatic" | PccPlanningEffort;
export type PccPlanningSurface =
  | "project_creation"
  | "project_replan"
  | "setup_repair"
  | "autopilot_prompts";

export type PccPlanningPolicy = {
  schemaVersion: typeof PCC_PLANNING_SCHEMA_VERSION;
  provider: PccPlanningProvider;
  model: string;
  runtime: PccPlanningRuntime;
  depth: PccPlanningDepth;
  grant: {
    kind: "persistent_planning_only";
    enabled: boolean;
    allowedSurfaces: PccPlanningSurface[];
    forbiddenActions: string[];
  };
};

export type PccPlanGenerationRequest = {
  surface: PccPlanningSurface;
  /** Local AI is the safe default. Codex must be selected explicitly per request. */
  plannerMode?: PccPlannerSelection;
  description: string;
  existingTitle?: string;
  existingGoal?: string;
  desiredOutcome?: string;
  constraints?: string[];
  preferredTemplateId?: PccWorkflowTemplateId;
  depth?: PccPlanningDepth;
};

export type PccGeneratedSubMilestone = {
  title: string;
  implementationPlan: string;
  acceptanceCriteria: string[];
  responsibility: string;
  proofLevel: string;
};

export type PccGeneratedMilestone = PccGeneratedSubMilestone & {
  phaseId: string;
  dependencies: number[];
  subMilestones: PccGeneratedSubMilestone[];
};

export type PccPlanProvenance = {
  generatedAt: string;
  provider: PccPlanningProvider;
  model: string;
  runtime: PccPlanningRuntime;
  effort: PccPlanningEffort;
  auth: "oauth" | "none";
  source: "live_local" | "live_codex" | "isolated_test_fixture";
  planningOnly: true;
};

export type PccPlanGenerationResult = {
  schemaVersion: typeof PCC_PLANNING_SCHEMA_VERSION;
  title: string;
  goal: string;
  outcomeMetrics: string[];
  workflowTemplateId: PccWorkflowTemplateId;
  milestones: PccGeneratedMilestone[];
  risks: string[];
  assumptions: string[];
  provenance: PccPlanProvenance;
};

export const CODEX_PCC_PLANNING_POLICY: PccPlanningPolicy = {
  schemaVersion: PCC_PLANNING_SCHEMA_VERSION,
  provider: "openai",
  model: PCC_CODEX_PLANNER_MODEL,
  runtime: "codex",
  depth: "automatic",
  grant: {
    kind: "persistent_planning_only",
    enabled: true,
    allowedSurfaces: ["project_creation", "project_replan", "setup_repair", "autopilot_prompts"],
    forbiddenActions: [
      "implementation",
      "deployment",
      "credential_change",
      "destructive_action",
      "purchase",
      "publication",
      "external_write",
    ],
  },
};

/** Local AI is the default planner. It cannot perform tools or external writes. */
export const DEFAULT_PCC_PLANNING_POLICY: PccPlanningPolicy = {
  ...CODEX_PCC_PLANNING_POLICY,
  provider: "ollama",
  model: PCC_LOCAL_PLANNER_MODEL,
  runtime: "openclaw",
};

function defaultPolicyForProvider(provider: PccPlanningProvider): PccPlanningPolicy {
  return provider === "openai" ? CODEX_PCC_PLANNING_POLICY : DEFAULT_PCC_PLANNING_POLICY;
}

function validPlannerModel(provider: PccPlanningProvider, value: unknown): value is string {
  return (
    typeof value === "string" &&
    (provider === "openai"
      ? /^openai\/gpt-5\.6-(?:sol|terra|luna)$/u.test(value)
      : /^ollama\/\S+$/u.test(value))
  );
}

export function normalizePccPlanningPolicy(value: unknown): PccPlanningPolicy {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const grant =
    source.grant && typeof source.grant === "object" && !Array.isArray(source.grant)
      ? (source.grant as Record<string, unknown>)
      : {};
  const depth = source.depth;
  const provider =
    source.provider === "openai" || source.provider === "ollama" ? source.provider : "ollama";
  const defaults = defaultPolicyForProvider(provider);
  const model = validPlannerModel(provider, source.model) ? source.model : defaults.model;
  return {
    ...defaults,
    provider,
    model,
    runtime: provider === "openai" ? "codex" : "openclaw",
    depth: depth === "medium" || depth === "high" || depth === "automatic" ? depth : "automatic",
    grant: {
      ...defaults.grant,
      enabled: typeof grant.enabled === "boolean" ? grant.enabled : true,
    },
  };
}

/**
 * Select the planner for one request. A legacy/shared Codex policy never silently
 * turns the default local planner back into hosted planning.
 */
export function resolvePccPlanningPolicy(
  value: unknown,
  plannerMode: PccPlannerSelection = "local",
): PccPlanningPolicy {
  const configured = normalizePccPlanningPolicy(value);
  const defaults =
    plannerMode === "codex" ? CODEX_PCC_PLANNING_POLICY : DEFAULT_PCC_PLANNING_POLICY;
  const keepConfiguredModel =
    (plannerMode === "codex" && configured.provider === "openai") ||
    (plannerMode === "local" && configured.provider === "ollama");
  return {
    ...defaults,
    ...(keepConfiguredModel ? { model: configured.model } : {}),
    depth: configured.depth,
    grant: {
      ...defaults.grant,
      enabled: configured.grant.enabled,
    },
  };
}

const HIGH_COMPLEXITY_RE =
  /\b(?:architecture|migration|concurren|parallel|security|credential|oauth|deploy|release|runtime|reliab|distributed|database|schema|integration|ambiguous|production)\b/iu;

export function resolvePccPlanningEffort(
  request: PccPlanGenerationRequest,
  policy: PccPlanningPolicy = DEFAULT_PCC_PLANNING_POLICY,
): PccPlanningEffort {
  const requested = request.depth ?? policy.depth;
  if (requested === "medium" || requested === "high") {
    return requested;
  }
  const combined = [
    request.description,
    request.existingGoal,
    request.desiredOutcome,
    ...(request.constraints ?? []),
  ]
    .filter(Boolean)
    .join("\n");
  return HIGH_COMPLEXITY_RE.test(combined) || combined.length > 2_400 ? "high" : "medium";
}

export function assertPccPlanningAuthorized(
  request: PccPlanGenerationRequest,
  policy: PccPlanningPolicy = DEFAULT_PCC_PLANNING_POLICY,
): void {
  if (policy.runtime === "codex" && !policy.grant.enabled) {
    throw new Error("Codex planning is disabled. Enable the planning-only grant to continue.");
  }
  if (!policy.grant.allowedSurfaces.includes(request.surface)) {
    throw new Error(`PCC planning is not authorized for ${request.surface}.`);
  }
  if (!request.description.trim()) {
    throw new Error("Describe what the project should accomplish before generating a plan.");
  }
}

export function buildPccPlanningPrompt(request: PccPlanGenerationRequest): string {
  const existing = [
    request.existingTitle ? `Existing title: ${request.existingTitle}` : "",
    request.existingGoal ? `Existing goal: ${request.existingGoal}` : "",
    request.desiredOutcome ? `Desired outcome: ${request.desiredOutcome}` : "",
    request.constraints?.length ? `Constraints:\n- ${request.constraints.join("\n- ")}` : "",
    request.preferredTemplateId ? `Preferred template: ${request.preferredTemplateId}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return `You are the planning engine for OpenClaw Project Command Center (PCC).

Create a specific, truthful, execution-ready project plan. Planning only: do not use tools, edit files, deploy, spend money, change credentials, publish, or perform external writes.

User description:
${request.description.trim()}
${existing ? `\nExisting user input (preserve unless it is blank):\n${existing}\n` : ""}
Return exactly one JSON object and no markdown. Use this shape:
{
  "title": "a concise real project name, never a pronoun or copied sentence",
  "goal": "a concrete outcome describing what will be accomplished",
  "outcomeMetrics": ["observable success metric"],
  "workflowTemplateId": "software-product|dashboard-data|creative-media|research|trading-finance|snes-studio|custom",
  "milestones": [{
    "title": "ordered outcome milestone",
    "phaseId": "setup|tools-skills|mvp|refinement|production-proof|maintenance",
    "implementationPlan": "specific execution steps and stop conditions",
    "acceptanceCriteria": ["observable pass condition"],
    "responsibility": "local_openclaw_agent|codex|high_reasoning_codex|remote_proof|user",
    "proofLevel": "local|remote|runtime|production",
    "dependencies": [],
    "subMilestones": [{
      "title": "small verifiable sub-step",
      "implementationPlan": "how to perform this sub-step",
      "acceptanceCriteria": ["observable pass condition"],
      "responsibility": "local_openclaw_agent|codex|high_reasoning_codex|remote_proof|user",
      "proofLevel": "local|remote|runtime|production"
    }]
  }],
  "risks": ["material risk or permission boundary"],
  "assumptions": ["explicit assumption"]
}

Requirements:
- Produce 4-10 milestones and 2-8 sub-milestones per milestone.
- This JSON is the executable project plan, not the Codex-checkpoint policy. Assign executable work
  to local_openclaw_agent, remote_proof, or user. PCC configures planning, architecture review,
  blocked recovery, and final review as separate visible Codex checkpoints.
- Do not assign codex or high_reasoning_codex as a milestone owner. PCC prevents those legacy values
  from overriding the separate checkpoint policy.
- Put dependencies in zero-based milestone indexes and never create cycles.
- Include acceptance criteria, proof level, and responsibility for every item.
- Never claim that an unavailable tool, permission, proof, or integration exists.`;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Codex returned a plan that was not a JSON object.");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`PCC planner is missing ${field}.`);
  }
  return value.trim();
}

const INVALID_PROJECT_TITLES = new Set([
  "a",
  "an",
  "i",
  "it",
  "my project",
  "project",
  "the project",
  "this",
  "this project",
]);

function projectTitle(value: unknown): string {
  const title = requiredString(value, "project title");
  if (title.length < 3 || INVALID_PROJECT_TITLES.has(title.toLowerCase())) {
    throw new Error("PCC planner returned a placeholder instead of a real project title.");
  }
  return title;
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`PCC planner is missing ${field}.`);
  }
  const result = value.map((item) => requiredString(item, field));
  if (result.length === 0) {
    throw new Error(`PCC planner requires at least one ${field}.`);
  }
  return result;
}

const TEMPLATE_IDS = new Set<PccWorkflowTemplateId>([
  "software-product",
  "dashboard-data",
  "creative-media",
  "research",
  "trading-finance",
  "snes-studio",
  "custom",
]);

function parseSubMilestone(value: unknown): PccGeneratedSubMilestone {
  const item = objectValue(value);
  const responsibility = requiredString(item.responsibility, "sub-milestone responsibility");
  const proofLevel = requiredString(item.proofLevel, "sub-milestone proof level");
  assertPlanningEnum(responsibility, RESPONSIBILITIES, "sub-milestone responsibility");
  assertPlanningEnum(proofLevel, PROOF_LEVELS, "sub-milestone proof level");
  return {
    title: requiredString(item.title, "sub-milestone title"),
    implementationPlan: requiredString(item.implementationPlan, "sub-milestone plan"),
    acceptanceCriteria: stringArray(item.acceptanceCriteria, "sub-milestone acceptance criterion"),
    responsibility,
    proofLevel,
  };
}

const RESPONSIBILITIES = new Set([
  "local_openclaw_agent",
  "codex",
  "high_reasoning_codex",
  "remote_proof",
  "user",
]);
const PROOF_LEVELS = new Set(["local", "remote", "runtime", "production"]);

function assertPlanningEnum(value: string, allowed: ReadonlySet<string>, field: string): void {
  if (!allowed.has(value)) {
    throw new Error(`PCC planner contains unsupported ${field} ${value}.`);
  }
}

function parseMilestone(value: unknown, milestoneCount: number): PccGeneratedMilestone {
  const item = objectValue(value);
  const subMilestones = Array.isArray(item.subMilestones)
    ? item.subMilestones.map(parseSubMilestone)
    : [];
  if (subMilestones.length === 0) {
    throw new Error("Every PCC milestone requires at least one sub-milestone.");
  }
  if (subMilestones.length > 8) {
    throw new Error("A PCC milestone cannot contain more than eight sub-milestones.");
  }
  const dependencies = Array.isArray(item.dependencies)
    ? item.dependencies.map((dependency) => {
        if (
          !Number.isInteger(dependency) ||
          Number(dependency) < 0 ||
          Number(dependency) >= milestoneCount
        ) {
          throw new Error("PCC planner contains an invalid milestone dependency.");
        }
        return Number(dependency);
      })
    : [];
  const responsibility = requiredString(item.responsibility, "milestone responsibility");
  const proofLevel = requiredString(item.proofLevel, "milestone proof level");
  assertPlanningEnum(responsibility, RESPONSIBILITIES, "milestone responsibility");
  assertPlanningEnum(proofLevel, PROOF_LEVELS, "milestone proof level");
  return {
    title: requiredString(item.title, "milestone title"),
    phaseId: requiredString(item.phaseId, "milestone phase"),
    implementationPlan: requiredString(item.implementationPlan, "milestone plan"),
    acceptanceCriteria: stringArray(item.acceptanceCriteria, "milestone acceptance criterion"),
    responsibility,
    proofLevel,
    dependencies: [...new Set(dependencies)],
    subMilestones,
  };
}

export function parsePccPlanGenerationResult(params: {
  text: string;
  effort: PccPlanningEffort;
  policy?: PccPlanningPolicy;
  model?: string;
  generatedAt?: string;
  auth?: PccPlanProvenance["auth"];
  source?: PccPlanProvenance["source"];
}): PccPlanGenerationResult {
  const policy = params.policy ?? CODEX_PCC_PLANNING_POLICY;
  const match = params.text.match(/\{[\s\S]*\}/u);
  if (!match) {
    throw new Error("PCC planner did not return a JSON project plan.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    throw new Error("PCC planner returned malformed project-plan JSON.");
  }
  const value = objectValue(parsed);
  if (!Array.isArray(value.milestones) || value.milestones.length === 0) {
    throw new Error("PCC planner requires at least one milestone.");
  }
  if (value.milestones.length > 10) {
    throw new Error("PCC planner cannot contain more than ten milestones.");
  }
  const rawMilestones = value.milestones;
  const templateId = requiredString(value.workflowTemplateId, "workflow template");
  if (!TEMPLATE_IDS.has(templateId as PccWorkflowTemplateId)) {
    throw new Error(`PCC planner returned unsupported workflow template ${templateId}.`);
  }
  const milestones = rawMilestones.map((item) => parseMilestone(item, rawMilestones.length));
  milestones.forEach((milestone, index) => {
    if (milestone.dependencies.some((dependency) => dependency >= index)) {
      throw new Error("PCC planner dependencies must point to earlier milestones.");
    }
  });
  return {
    schemaVersion: PCC_PLANNING_SCHEMA_VERSION,
    title: projectTitle(value.title),
    goal: requiredString(value.goal, "project goal"),
    outcomeMetrics: stringArray(value.outcomeMetrics, "outcome metric"),
    workflowTemplateId: templateId as PccWorkflowTemplateId,
    milestones,
    risks: Array.isArray(value.risks)
      ? value.risks.map((item) => requiredString(item, "risk"))
      : [],
    assumptions: Array.isArray(value.assumptions)
      ? value.assumptions.map((item) => requiredString(item, "assumption"))
      : [],
    provenance: {
      generatedAt: params.generatedAt ?? new Date().toISOString(),
      provider: policy.provider,
      model: params.model ?? policy.model,
      runtime: policy.runtime,
      effort: params.effort,
      auth: params.auth ?? (policy.runtime === "codex" ? "oauth" : "none"),
      source: params.source ?? (policy.runtime === "codex" ? "live_codex" : "live_local"),
      planningOnly: true,
    },
  };
}

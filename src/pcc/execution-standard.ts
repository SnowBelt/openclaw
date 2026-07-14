export const PCC_EXECUTION_STANDARD_SCHEMA_VERSION = 1 as const;
export const PCC_EXECUTION_STANDARD_POLICY = "automatic_local_first" as const;
export const PCC_EXECUTION_QUALITY_TARGET = 93 as const;
export const PCC_EXECUTION_MAX_REPAIR_PASSES = 2 as const;

export type PccExecutionWorkKind =
  | "generic"
  | "software"
  | "debugging"
  | "ui_ux"
  | "testing"
  | "performance"
  | "documentation"
  | "research"
  | "security"
  | "release_operations";

export type PccExecutionPhase =
  | "understand"
  | "preflight"
  | "plan"
  | "execute"
  | "verify"
  | "judge"
  | "repair"
  | "record";

export type PccExecutionCapabilityStatus = "ready" | "fallback" | "blocked";

export type PccExecutionSkillDescriptor = {
  skillKey: string;
  name: string;
  description: string;
  eligible: boolean;
  modelVisible?: boolean;
  disabled?: boolean;
  blockedByAllowlist?: boolean;
  blockedByAgentFilter?: boolean;
  missing?: {
    bins?: readonly string[];
    env?: readonly string[];
    config?: readonly string[];
    os?: readonly string[];
  };
};

export type PccExecutionCapabilityDefinition = {
  id: string;
  title: string;
  phase: PccExecutionPhase;
  appliesTo: readonly PccExecutionWorkKind[];
  preferredSkillKeys: readonly string[];
  fallback: string;
  why: string;
  evidenceIds: readonly string[];
};

export type PccResolvedExecutionCapability = PccExecutionCapabilityDefinition & {
  status: PccExecutionCapabilityStatus;
  selectedSkillKeys: readonly string[];
  selectionReason: string;
};

export type PccExecutionQualityDimension =
  | "speed"
  | "accuracy"
  | "efficiency"
  | "first_pass_quality"
  | "qa"
  | "overall_quality";

export type PccExecutionQualityRequirement = {
  id: string;
  dimension: PccExecutionQualityDimension;
  label: string;
};

export type PccExecutionQualityAssessment = {
  target: typeof PCC_EXECUTION_QUALITY_TARGET;
  scores: Readonly<Record<PccExecutionQualityDimension, number>>;
  minimumScore: number;
  judgePassed: boolean;
  passed: boolean;
  missingEvidenceIds: readonly string[];
};

export type PccExecutionStandard = {
  schemaVersion: typeof PCC_EXECUTION_STANDARD_SCHEMA_VERSION;
  policy: typeof PCC_EXECUTION_STANDARD_POLICY;
  qualityTarget: typeof PCC_EXECUTION_QUALITY_TARGET;
  maxRepairPasses: typeof PCC_EXECUTION_MAX_REPAIR_PASSES;
  scope: "pcc_product" | "project_work";
  workKinds: readonly PccExecutionWorkKind[];
  workflow: readonly PccExecutionPhase[];
  capabilities: readonly PccResolvedExecutionCapability[];
  selectedSkillKeys: readonly string[];
  status: "ready" | "blocked";
  blockers: readonly string[];
  warnings: readonly string[];
  selectionTrace: readonly string[];
};

export type PccExecutionStandardMetadata = {
  schemaVersion: typeof PCC_EXECUTION_STANDARD_SCHEMA_VERSION;
  policy: typeof PCC_EXECUTION_STANDARD_POLICY;
  qualityTarget: typeof PCC_EXECUTION_QUALITY_TARGET;
  learningPromotionTarget: typeof PCC_EXECUTION_QUALITY_TARGET;
  maxRepairPasses: typeof PCC_EXECUTION_MAX_REPAIR_PASSES;
  contributionContract: "manifest_and_contract_tests_required";
};

const WORKFLOW: readonly PccExecutionPhase[] = [
  "understand",
  "preflight",
  "plan",
  "execute",
  "verify",
  "judge",
  "repair",
  "record",
];

export const PCC_EXECUTION_QUALITY_REQUIREMENTS: readonly PccExecutionQualityRequirement[] = [
  { id: "preflight_complete", dimension: "speed", label: "Preflight completed once" },
  { id: "capacity_bounded", dimension: "speed", label: "Capacity was bounded before dispatch" },
  { id: "no_avoidable_retry", dimension: "speed", label: "No avoidable retry was introduced" },
  {
    id: "acceptance_verified",
    dimension: "accuracy",
    label: "Acceptance criteria were verified",
  },
  {
    id: "dependency_contract_verified",
    dimension: "accuracy",
    label: "Dependency contracts were verified",
  },
  { id: "proof_bound", dimension: "accuracy", label: "Proof is bound to the exact result" },
  { id: "no_duplicate_work", dimension: "efficiency", label: "Duplicate work was avoided" },
  {
    id: "local_first_routing",
    dimension: "efficiency",
    label: "Local-first routing followed the project profile",
  },
  { id: "context_bounded", dimension: "efficiency", label: "Context was relevant and bounded" },
  {
    id: "requirements_resolved",
    dimension: "first_pass_quality",
    label: "Requirements were resolved before implementation",
  },
  {
    id: "targeted_plan_followed",
    dimension: "first_pass_quality",
    label: "The targeted plan was followed",
  },
  {
    id: "focused_checks_passed",
    dimension: "first_pass_quality",
    label: "Focused checks passed on the first implementation pass",
  },
  { id: "tests_passed", dimension: "qa", label: "Applicable tests passed" },
  { id: "type_build_passed", dimension: "qa", label: "Type and build checks passed" },
  {
    id: "manual_or_browser_verified",
    dimension: "qa",
    label: "The user-facing result was manually or browser verified",
  },
  {
    id: "scope_satisfied",
    dimension: "overall_quality",
    label: "The requested scope was satisfied",
  },
  {
    id: "risks_documented",
    dimension: "overall_quality",
    label: "Remaining risks and limitations were documented",
  },
  {
    id: "completion_truthful",
    dimension: "overall_quality",
    label: "Completion matches the verified proof surface",
  },
];

export const PCC_EXECUTION_CAPABILITY_REGISTRY: readonly PccExecutionCapabilityDefinition[] = [
  {
    id: "scope_and_instructions",
    title: "Resolve scope and instructions",
    phase: "understand",
    appliesTo: ["generic"],
    preferredSkillKeys: [],
    fallback: "Use PCC project scope, goal, acceptance criteria, and explicit user constraints.",
    why: "Prevents work from starting with ambiguous ownership or conflicting instructions.",
    evidenceIds: ["requirements_resolved", "scope_satisfied"],
  },
  {
    id: "permission_preflight",
    title: "Run permission and safety preflight",
    phase: "preflight",
    appliesTo: ["generic"],
    preferredSkillKeys: [],
    fallback:
      "Use PCC permission grants, forbidden-action rules, scope lock, and capacity governor.",
    why: "Stops unsafe or unavailable work before execution spends time or changes state.",
    evidenceIds: ["preflight_complete", "capacity_bounded"],
  },
  {
    id: "implementation_plan",
    title: "Plan and partition the work",
    phase: "plan",
    appliesTo: ["generic"],
    preferredSkillKeys: [],
    fallback: "Use the PCC implementation plan, dependency order, and workspace leases.",
    why: "Creates one deterministic route through the work without duplicate ownership.",
    evidenceIds: ["targeted_plan_followed", "no_duplicate_work", "context_bounded"],
  },
  {
    id: "software_delivery",
    title: "Use the OpenClaw software delivery workflow",
    phase: "execute",
    appliesTo: ["software"],
    preferredSkillKeys: ["openclaw-testing"],
    fallback: "Use repository instructions, targeted tests, type checks, and build gates.",
    why: "Keeps implementation and verification aligned with the OpenClaw repository contract.",
    evidenceIds: ["local_first_routing", "tests_passed", "type_build_passed"],
  },
  {
    id: "debugging",
    title: "Use the production debugging workflow",
    phase: "execute",
    appliesTo: ["debugging"],
    preferredSkillKeys: ["openclaw-debugging"],
    fallback: "Reproduce, trace the owner path, isolate root cause, then prove the repair.",
    why: "Prevents symptom patches and requires a verified root cause.",
    evidenceIds: ["dependency_contract_verified", "no_avoidable_retry"],
  },
  {
    id: "ui_browser_proof",
    title: "Use live UI interaction proof",
    phase: "verify",
    appliesTo: ["ui_ux"],
    preferredSkillKeys: ["control-ui-e2e"],
    fallback: "Use maintained browser proof at desktop and mobile breakpoints.",
    why: "Catches overlap, hidden controls, broken buttons, and persistence failures.",
    evidenceIds: ["manual_or_browser_verified", "acceptance_verified"],
  },
  {
    id: "test_verification",
    title: "Use the targeted OpenClaw test workflow",
    phase: "verify",
    appliesTo: ["testing"],
    preferredSkillKeys: ["openclaw-testing"],
    fallback: "Run the cheapest relevant unit, integration, type, build, and live checks.",
    why: "Uses the proof surface that can actually detect regression in the changed behavior.",
    evidenceIds: ["tests_passed", "type_build_passed", "focused_checks_passed"],
  },
  {
    id: "performance",
    title: "Use the performance measurement workflow",
    phase: "verify",
    appliesTo: ["performance"],
    preferredSkillKeys: ["openclaw-test-performance"],
    fallback: "Measure before and after against an explicit performance budget.",
    why: "Prevents unmeasured speed claims and optimizations that move cost elsewhere.",
    evidenceIds: ["no_avoidable_retry", "focused_checks_passed"],
  },
  {
    id: "documentation",
    title: "Use the canonical documentation workflow",
    phase: "record",
    appliesTo: ["documentation"],
    preferredSkillKeys: ["technical-documentation"],
    fallback: "Update the canonical owner document and link to it instead of duplicating policy.",
    why: "Keeps future OpenClaw and Codex runs on one current source of truth.",
    evidenceIds: ["context_bounded", "completion_truthful"],
  },
  {
    id: "security",
    title: "Use security triage and fail-closed handling",
    phase: "preflight",
    appliesTo: ["security"],
    preferredSkillKeys: ["security-triage"],
    fallback: "Treat untrusted content and sensitive actions as blocked pending scoped review.",
    why: "Separates safe diagnosis from credential, destructive, or disclosure actions.",
    evidenceIds: ["preflight_complete", "risks_documented"],
  },
  {
    id: "release_proof",
    title: "Use remote and release proof only when required",
    phase: "verify",
    appliesTo: ["release_operations"],
    preferredSkillKeys: ["crabbox", "verify-release"],
    fallback: "Use the repository's exact-SHA CI, runtime, and browser proof gates.",
    why: "Binds release claims to the exact source and runtime without making every task expensive.",
    evidenceIds: ["proof_bound", "completion_truthful"],
  },
  {
    id: "independent_judge",
    title: "Require independent completion review",
    phase: "judge",
    appliesTo: ["generic"],
    preferredSkillKeys: [],
    fallback:
      "Use a separate review pass against intent, checks, proof, risks, and completion truth.",
    why: "The executor cannot award its own final completion grade.",
    evidenceIds: ["acceptance_verified", "risks_documented", "completion_truthful"],
  },
  {
    id: "bounded_repair",
    title: "Repair failed quality checks",
    phase: "repair",
    appliesTo: ["generic"],
    preferredSkillKeys: [],
    fallback: "Run at most two targeted local repair passes, then stop with the exact blocker.",
    why: "Improves first-pass output without creating an unbounded or repetitive loop.",
    evidenceIds: ["no_avoidable_retry", "focused_checks_passed"],
  },
  {
    id: "proof_and_learning",
    title: "Record proof and evidence-bound learning",
    phase: "record",
    appliesTo: ["generic"],
    preferredSkillKeys: [],
    fallback:
      "Save sanitized proof, a truthful receipt, and recommendation-only learning evidence.",
    why: "Makes future work faster while preventing unverified self-modification.",
    evidenceIds: ["proof_bound", "completion_truthful"],
  },
];

const KIND_PATTERNS: ReadonlyArray<readonly [PccExecutionWorkKind, RegExp]> = [
  ["debugging", /\b(?:bug|debug|failure|crash|broken|error|root cause|incident|regression)\b/iu],
  [
    "ui_ux",
    /\b(?:ui|ux|user interface|dashboard|browser|mobile|desktop|layout|css|visual|button)\b/iu,
  ],
  [
    "testing",
    /\b(?:test|verify|verification|proof|qa|quality assurance|smoke|e2e|typecheck|build)\b/iu,
  ],
  ["performance", /\b(?:performance|latency|speed|slow|memory|cpu|throughput|efficien)\w*\b/iu],
  ["documentation", /\b(?:docs?|documentation|readme|skill|workflow|process|runbook|guide)\b/iu],
  ["research", /\b(?:research|investigate|compare|evaluate|source|market)\b/iu],
  ["security", /\b(?:security|credential|secret|auth|permission|vulnerab|threat|unsafe)\w*\b/iu],
  [
    "release_operations",
    /\b(?:release|deploy|runtime|production|publish|remote proof|github|ci)\b/iu,
  ],
  [
    "software",
    /\b(?:code|source|typescript|javascript|implement|refactor|gateway|api|schema|repository)\b/iu,
  ],
];

const CORE_CAPABILITY_IDS = new Set([
  "scope_and_instructions",
  "permission_preflight",
  "implementation_plan",
  "independent_judge",
  "bounded_repair",
  "proof_and_learning",
]);

const EXECUTION_PHASES = new Set<PccExecutionPhase>(WORKFLOW);
const EXECUTION_WORK_KINDS = new Set<PccExecutionWorkKind>([
  "generic",
  "software",
  "debugging",
  "ui_ux",
  "testing",
  "performance",
  "documentation",
  "research",
  "security",
  "release_operations",
]);

const STOP_WORDS = new Set([
  "and",
  "for",
  "from",
  "into",
  "project",
  "that",
  "the",
  "this",
  "with",
  "work",
]);

function normalizedTokens(value: string): string[] {
  return [
    ...new Set(
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, " ")
        .split(/\s+/u)
        .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
    ),
  ];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    return null;
  }
  return [...value];
}

function capabilitySnapshot(value: unknown): PccResolvedExecutionCapability | null {
  const source = record(value);
  const appliesTo = stringArray(source.appliesTo);
  const preferredSkillKeys = stringArray(source.preferredSkillKeys);
  const evidenceIds = stringArray(source.evidenceIds);
  const selectedSkillKeys = stringArray(source.selectedSkillKeys);
  if (
    typeof source.id !== "string" ||
    typeof source.title !== "string" ||
    typeof source.phase !== "string" ||
    !EXECUTION_PHASES.has(source.phase as PccExecutionPhase) ||
    !appliesTo ||
    !appliesTo.every((kind) => EXECUTION_WORK_KINDS.has(kind as PccExecutionWorkKind)) ||
    !preferredSkillKeys ||
    typeof source.fallback !== "string" ||
    typeof source.why !== "string" ||
    !evidenceIds ||
    (source.status !== "ready" && source.status !== "fallback" && source.status !== "blocked") ||
    !selectedSkillKeys ||
    typeof source.selectionReason !== "string"
  ) {
    return null;
  }
  return {
    id: source.id,
    title: source.title,
    phase: source.phase as PccExecutionPhase,
    appliesTo: appliesTo as PccExecutionWorkKind[],
    preferredSkillKeys,
    fallback: source.fallback,
    why: source.why,
    evidenceIds,
    status: source.status,
    selectedSkillKeys,
    selectionReason: source.selectionReason,
  };
}

function missingSkillReason(skill: PccExecutionSkillDescriptor): string {
  if (skill.disabled) {
    return `${skill.skillKey} is disabled.`;
  }
  if (skill.blockedByAllowlist) {
    return `${skill.skillKey} is blocked by the skill allowlist.`;
  }
  if (skill.blockedByAgentFilter) {
    return `${skill.skillKey} is blocked for the selected agent.`;
  }
  const missing = skill.missing;
  const requirements = [
    ...(missing?.bins ?? []),
    ...(missing?.env ?? []),
    ...(missing?.config ?? []),
    ...(missing?.os ?? []),
  ];
  return requirements.length
    ? `${skill.skillKey} is missing: ${requirements.join(", ")}.`
    : `${skill.skillKey} is not eligible.`;
}

function availableSkill(skill: PccExecutionSkillDescriptor): boolean {
  return skill.eligible && skill.modelVisible !== false && !skill.disabled;
}

function resolveCapability(
  definition: PccExecutionCapabilityDefinition,
  skills: readonly PccExecutionSkillDescriptor[] | null,
): PccResolvedExecutionCapability {
  if (definition.preferredSkillKeys.length === 0) {
    return {
      ...definition,
      status: "fallback",
      selectedSkillKeys: [],
      selectionReason: definition.fallback,
    };
  }
  if (skills === null) {
    return {
      ...definition,
      status: "blocked",
      selectedSkillKeys: [],
      selectionReason: "The live skill catalog could not be loaded.",
    };
  }
  const exact = definition.preferredSkillKeys
    .map((skillKey) =>
      skills.find((skill) => skill.skillKey === skillKey || skill.name === skillKey),
    )
    .filter((skill): skill is PccExecutionSkillDescriptor => Boolean(skill));
  const selected = exact.filter(availableSkill).map((skill) => skill.skillKey);
  if (selected.length > 0) {
    return {
      ...definition,
      status: "ready",
      selectedSkillKeys: selected,
      selectionReason: `Selected ${selected.join(", ")} from the live eligible skill catalog.`,
    };
  }
  if (exact.length > 0) {
    return {
      ...definition,
      status: "blocked",
      selectedSkillKeys: [],
      selectionReason: exact.map(missingSkillReason).join(" "),
    };
  }
  return {
    ...definition,
    status: "fallback",
    selectedSkillKeys: [],
    selectionReason: `${definition.preferredSkillKeys.join(" or ")} is not installed; ${definition.fallback}`,
  };
}

function dynamicDomainSkills(
  text: string,
  skills: readonly PccExecutionSkillDescriptor[],
  selectedSkillKeys: ReadonlySet<string>,
): PccExecutionSkillDescriptor[] {
  const taskTokens = new Set(normalizedTokens(text));
  if (taskTokens.size === 0) {
    return [];
  }
  return skills
    .filter((skill) => availableSkill(skill) && !selectedSkillKeys.has(skill.skillKey))
    .map((skill) => {
      const skillTokens = normalizedTokens(`${skill.skillKey} ${skill.name} ${skill.description}`);
      const score = skillTokens.filter((token) => taskTokens.has(token)).length;
      return { skill, score };
    })
    .filter((item) => item.score >= 2)
    .toSorted(
      (left, right) =>
        right.score - left.score || left.skill.skillKey.localeCompare(right.skill.skillKey),
    )
    .slice(0, 3)
    .map((item) => item.skill);
}

export function canonicalPccExecutionStandardMetadata(): PccExecutionStandardMetadata {
  return {
    schemaVersion: PCC_EXECUTION_STANDARD_SCHEMA_VERSION,
    policy: PCC_EXECUTION_STANDARD_POLICY,
    qualityTarget: PCC_EXECUTION_QUALITY_TARGET,
    learningPromotionTarget: PCC_EXECUTION_QUALITY_TARGET,
    maxRepairPasses: PCC_EXECUTION_MAX_REPAIR_PASSES,
    contributionContract: "manifest_and_contract_tests_required",
  };
}

/** Reads only a complete, canonical execution-standard snapshot. */
export function readPccExecutionStandardSnapshot(value: unknown): PccExecutionStandard | null {
  const source = record(value);
  const workKinds = stringArray(source.workKinds);
  const workflow = stringArray(source.workflow);
  const selectedSkillKeys = stringArray(source.selectedSkillKeys);
  const blockers = stringArray(source.blockers);
  const warnings = stringArray(source.warnings);
  const selectionTrace = stringArray(source.selectionTrace);
  const capabilities = Array.isArray(source.capabilities)
    ? source.capabilities.map(capabilitySnapshot)
    : [];
  if (
    source.schemaVersion !== PCC_EXECUTION_STANDARD_SCHEMA_VERSION ||
    source.policy !== PCC_EXECUTION_STANDARD_POLICY ||
    source.qualityTarget !== PCC_EXECUTION_QUALITY_TARGET ||
    source.maxRepairPasses !== PCC_EXECUTION_MAX_REPAIR_PASSES ||
    (source.scope !== "pcc_product" && source.scope !== "project_work") ||
    !workKinds ||
    !workKinds.every((kind) => EXECUTION_WORK_KINDS.has(kind as PccExecutionWorkKind)) ||
    !workflow ||
    workflow.length !== WORKFLOW.length ||
    !workflow.every((phase, index) => phase === WORKFLOW[index]) ||
    !Array.isArray(source.capabilities) ||
    capabilities.some((capability) => capability === null) ||
    !selectedSkillKeys ||
    (source.status !== "ready" && source.status !== "blocked") ||
    !blockers ||
    !warnings ||
    !selectionTrace
  ) {
    return null;
  }
  return {
    schemaVersion: PCC_EXECUTION_STANDARD_SCHEMA_VERSION,
    policy: PCC_EXECUTION_STANDARD_POLICY,
    qualityTarget: PCC_EXECUTION_QUALITY_TARGET,
    maxRepairPasses: PCC_EXECUTION_MAX_REPAIR_PASSES,
    scope: source.scope,
    workKinds: workKinds as PccExecutionWorkKind[],
    workflow: workflow as PccExecutionPhase[],
    capabilities: capabilities as PccResolvedExecutionCapability[],
    selectedSkillKeys,
    status: source.status,
    blockers,
    warnings,
    selectionTrace,
  };
}

export function classifyPccExecutionWorkKinds(text: string): PccExecutionWorkKind[] {
  const kinds = KIND_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([kind]) => kind);
  return ["generic", ...new Set(kinds)] as PccExecutionWorkKind[];
}

export function buildPccExecutionStandard(input: {
  scope: "pcc_product" | "project_work";
  title: string;
  goal?: string;
  currentWorkTitle?: string;
  currentWorkDetails?: string;
  availableSkills?: readonly PccExecutionSkillDescriptor[] | null;
}): PccExecutionStandard {
  const text = [input.title, input.goal, input.currentWorkTitle, input.currentWorkDetails]
    .filter(Boolean)
    .join("\n");
  const workKinds = classifyPccExecutionWorkKinds(text);
  const applicable = PCC_EXECUTION_CAPABILITY_REGISTRY.filter(
    (definition) =>
      CORE_CAPABILITY_IDS.has(definition.id) ||
      definition.appliesTo.some((kind) => workKinds.includes(kind)),
  );
  const catalog = input.availableSkills === undefined ? null : input.availableSkills;
  const capabilities = applicable.map((definition) => resolveCapability(definition, catalog));
  const selectedSkillKeys = new Set(capabilities.flatMap((item) => item.selectedSkillKeys));
  const dynamicSkills = catalog ? dynamicDomainSkills(text, catalog, selectedSkillKeys) : [];
  dynamicSkills.forEach((skill) => selectedSkillKeys.add(skill.skillKey));
  const dynamicTrace = dynamicSkills.map(
    (skill) =>
      `Selected ${skill.skillKey} because its live description matches this project's work.`,
  );
  const blockers = [
    ...(catalog === null
      ? [
          "Live skill catalog could not be loaded. Refresh PCC and restore skills.status before starting work.",
        ]
      : []),
    ...capabilities
      .filter((capability) => capability.status === "blocked")
      .map((capability) => `${capability.title}: ${capability.selectionReason}`),
  ];
  const warnings = capabilities
    .filter(
      (capability) => capability.status === "fallback" && capability.preferredSkillKeys.length,
    )
    .map((capability) => `${capability.title}: ${capability.selectionReason}`);
  return {
    schemaVersion: PCC_EXECUTION_STANDARD_SCHEMA_VERSION,
    policy: PCC_EXECUTION_STANDARD_POLICY,
    qualityTarget: PCC_EXECUTION_QUALITY_TARGET,
    maxRepairPasses: PCC_EXECUTION_MAX_REPAIR_PASSES,
    scope: input.scope,
    workKinds,
    workflow: WORKFLOW,
    capabilities,
    selectedSkillKeys: [...selectedSkillKeys].toSorted(),
    status: blockers.length > 0 ? "blocked" : "ready",
    blockers,
    warnings,
    selectionTrace: [
      `Detected work kinds: ${workKinds.join(", ")}.`,
      ...capabilities.map((capability) => `${capability.title}: ${capability.selectionReason}`),
      ...dynamicTrace,
    ],
  };
}

export function evaluatePccExecutionQuality(input: {
  provenEvidenceIds: readonly string[];
  judgePassed: boolean;
}): PccExecutionQualityAssessment {
  const proven = new Set(input.provenEvidenceIds);
  const dimensions: readonly PccExecutionQualityDimension[] = [
    "speed",
    "accuracy",
    "efficiency",
    "first_pass_quality",
    "qa",
    "overall_quality",
  ];
  const scores = Object.fromEntries(
    dimensions.map((dimension) => {
      const requirements = PCC_EXECUTION_QUALITY_REQUIREMENTS.filter(
        (requirement) => requirement.dimension === dimension,
      );
      const evidenceScore =
        requirements.filter((requirement) => proven.has(requirement.id)).length * 31;
      return [dimension, Math.min(100, evidenceScore + (input.judgePassed ? 7 : 0))];
    }),
  ) as Record<PccExecutionQualityDimension, number>;
  const missingEvidenceIds = PCC_EXECUTION_QUALITY_REQUIREMENTS.filter(
    (requirement) => !proven.has(requirement.id),
  ).map((requirement) => requirement.id);
  const minimumScore = Math.min(...Object.values(scores));
  return {
    target: PCC_EXECUTION_QUALITY_TARGET,
    scores,
    minimumScore,
    judgePassed: input.judgePassed,
    passed:
      input.judgePassed &&
      missingEvidenceIds.length === 0 &&
      minimumScore >= PCC_EXECUTION_QUALITY_TARGET,
    missingEvidenceIds,
  };
}

export function buildPccExecutionStandardPrompt(standard: PccExecutionStandard): string {
  return [
    `PCC execution standard v${standard.schemaVersion}: ${standard.policy}.`,
    `Scope: ${standard.scope}. Quality target: at least ${standard.qualityTarget}/100 in speed, accuracy, efficiency, first-pass quality, QA, and overall quality.`,
    `Workflow: ${standard.workflow.join(" -> ")}.`,
    `Required skills: ${standard.selectedSkillKeys.length ? standard.selectedSkillKeys.join(", ") : "No specialized skill matched; use the built-in workflow."}`,
    "Load and follow every listed skill before doing its work. Do not substitute an unavailable skill silently.",
    `Run no more than ${standard.maxRepairPasses} targeted repair passes after failed verification, then stop with the exact blocker.`,
    "A separate judge must verify intent, checks, proof, risks, and completion. The executor cannot award its own completion grade.",
    `Required evidence IDs: ${PCC_EXECUTION_QUALITY_REQUIREMENTS.map((item) => item.id).join(", ")}.`,
    "Do not claim completion below the target or without all required evidence and an independent judge pass.",
  ].join("\n");
}

export function validatePccExecutionCapabilityRegistry(
  registry: readonly PccExecutionCapabilityDefinition[] = PCC_EXECUTION_CAPABILITY_REGISTRY,
): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const evidenceIds = new Set(PCC_EXECUTION_QUALITY_REQUIREMENTS.map((item) => item.id));
  for (const capability of registry) {
    if (ids.has(capability.id)) {
      errors.push(`Duplicate capability id: ${capability.id}`);
    }
    ids.add(capability.id);
    if (!capability.fallback.trim()) {
      errors.push(`${capability.id} is missing fallback guidance.`);
    }
    if (!capability.why.trim()) {
      errors.push(`${capability.id} is missing selection rationale.`);
    }
    for (const evidenceId of capability.evidenceIds) {
      if (!evidenceIds.has(evidenceId)) {
        errors.push(`${capability.id} references unknown evidence ${evidenceId}.`);
      }
    }
  }
  const phases = new Set(registry.map((item) => item.phase));
  for (const phase of WORKFLOW) {
    if (!phases.has(phase)) {
      errors.push(`No capability covers workflow phase ${phase}.`);
    }
  }
  return errors;
}

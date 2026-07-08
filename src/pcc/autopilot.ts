// Project Command Center Autopilot Project Loop durable metadata helpers.
import type {
  PccDecision,
  PccEvidence,
  PccMilestone,
  PccPermissionGrant,
  PccProject,
  PccSubMilestone,
} from "../../packages/gateway-protocol/src/schema/types.js";

export type PccAutopilotStatus =
  | "off"
  | "ready"
  | "running"
  | "paused"
  | "blocked"
  | "needs_approval"
  | "failed"
  | "completed";

export type PccAutopilotModeId =
  | "full_build_review"
  | "continuous_improvement"
  | "bug_hunt"
  | "production_readiness"
  | "ui_ux_polish"
  | "refactor"
  | "test_verify"
  | "milestone_cleanup"
  | "launch_prep";

export type PccAutopilotExecutorKind = "codex" | "local_model" | "safe_stub";
export type PccAutopilotReasoningLevel = "standard" | "high";
export type PccAutopilotApprovalTier = "low" | "medium" | "high";
export type PccAutopilotJudgeSetting = "off" | "optional" | "mandatory";
export type PccAutopilotAction =
  | "start"
  | "pause"
  | "resume"
  | "stop"
  | "block"
  | "judge"
  | "allow_low_risk"
  | "allow_medium_risk"
  | "allow_high_risk"
  | "deny_permission";

export type PccAutopilotPromptSlot = {
  id: string;
  enabled: boolean;
  title: string;
  promptBody: string;
  purpose: string;
  executor: PccAutopilotExecutorKind;
  reasoningLevel?: PccAutopilotReasoningLevel;
  localModelId?: string;
  backupModelId?: string;
  approvalTier: PccAutopilotApprovalTier;
  judge: PccAutopilotJudgeSetting;
  version: number;
  lastRunResult?: string;
  lastRunAt?: string;
};

export type PccAutopilotStopCondition = {
  kind:
    | "after_n_sets"
    | "after_n_prompt_runs"
    | "after_current_prompt"
    | "after_current_set"
    | "blocked"
    | "max_failures"
    | "judge_failure"
    | "no_meaningful_improvement"
    | "max_risk_tier"
    | "max_changed_files";
  limit?: number;
  enabled: boolean;
};

export type PccAutopilotApprovalPolicy = {
  allowLowRisk: boolean;
  allowMediumRisk: boolean;
  allowHighRisk: boolean;
  maxRiskTier: PccAutopilotApprovalTier;
  note: string;
};

export type PccAutopilotPermissionForecast = {
  required: boolean;
  requiredTier: PccAutopilotApprovalTier | null;
  promptSlotIds: string[];
  promptTitles: string[];
  reason: string;
  recommendedNextAction: string;
  policySummary: string;
};

export type PccAutopilotContextPack = {
  projectSummary: string;
  selectedLoopMode: PccAutopilotModeId;
  currentObjective: string;
  activeMilestones: string[];
  blockers: string[];
  recentChanges: string[];
  priorPromptOutput: string;
  currentRisks: string[];
  definitionOfDone: string[];
  relevantArtifacts: string[];
  approvalRules: string[];
  forbiddenActions: string[];
  userPreferences: string[];
  judgeFindings: string[];
  stopConditions: string[];
};

export type PccAutopilotRunRecord = {
  id: string;
  timestamp: string;
  projectId: string;
  loopMode: PccAutopilotModeId;
  promptSlotId: string;
  promptTitle: string;
  promptVersion: number;
  executor: PccAutopilotExecutorKind;
  model?: string;
  reasoningLevel?: PccAutopilotReasoningLevel;
  inputContextSummary: string;
  outputSummary: string;
  changedFiles: string[];
  artifacts: string[];
  approvals: string[];
  checksRun: string[];
  judgeResult?: PccAutopilotJudgeResult;
  blocker?: PccAutopilotBlocker;
  rawOutput: string;
  useful?: boolean;
};

export type PccAutopilotBlockerType =
  | "needs_user_decision"
  | "needs_approval"
  | "tool_unavailable"
  | "api_unavailable"
  | "missing_credential"
  | "test_failure"
  | "build_failure"
  | "ambiguous_requirement"
  | "conflicting_instruction"
  | "unsafe_action"
  | "repeated_failure"
  | "external_dependency"
  | "no_meaningful_improvement_found";

export type PccAutopilotBlocker = {
  type: PccAutopilotBlockerType;
  whyBlocked: string;
  attempted: string;
  needed: string;
  recommendedNextAction: string;
  owner: string;
};

export type PccAutopilotJudgeResult = {
  status: "not_run" | "passed" | "failed";
  summary: string;
  evidence: string[];
  repairRecommendation?: string;
  reviewedAt?: string;
};

export type PccAutopilotFinalReport = {
  projectName: string;
  selectedLoopMode: PccAutopilotModeId;
  promptsUsed: string[];
  promptVersions: string[];
  setsCompleted: number;
  totalPromptRuns: number;
  issuesFound: string[];
  issuesFixed: string[];
  issuesUnresolved: string[];
  blockersEncountered: string[];
  approvalsUsed: string[];
  filesChanged: string[];
  artifactsCreated: string[];
  checksRun: string[];
  judgeResult: string;
  remainingRisks: string[];
  recommendedNextLoop: PccAutopilotModeId;
  healthierThanBefore: boolean;
  generatedAt: string;
};

export type PccAutopilotState = {
  version: 1;
  status: PccAutopilotStatus;
  mode: PccAutopilotModeId;
  modeTitle: string;
  promptSlots: PccAutopilotPromptSlot[];
  approvalPolicy: PccAutopilotApprovalPolicy;
  stopConditions: PccAutopilotStopCondition[];
  currentSet: number;
  completedSets: number;
  totalPromptIterations: number;
  activePromptSlotId?: string;
  currentExecutor: PccAutopilotExecutorKind;
  currentModel?: string;
  lastOutputSummary?: string;
  currentBlocker?: PccAutopilotBlocker;
  latestJudgeResult?: PccAutopilotJudgeResult;
  runHistory: PccAutopilotRunRecord[];
  auditLog: Array<{ at: string; event: string; summary: string }>;
  finalReport?: PccAutopilotFinalReport;
  updatedAt: string;
};

export type PccAutopilotModePreset = {
  id: PccAutopilotModeId;
  title: string;
  description: string;
  defaultPromptTitles: string[];
  suggestedExecutor: PccAutopilotExecutorKind;
  suggestedReasoningLevel: PccAutopilotReasoningLevel;
  suggestedJudge: PccAutopilotJudgeSetting;
  approvalTier: PccAutopilotApprovalTier;
  defaultStopCondition: PccAutopilotStopCondition;
};

export type PccAutopilotProjectInput = {
  project: PccProject;
  milestones: PccMilestone[];
  subMilestones: PccSubMilestone[];
  permissions?: PccPermissionGrant[];
  evidence?: PccEvidence[];
  decisions?: PccDecision[];
};

export const PCC_AUTOPILOT_MODES: PccAutopilotModePreset[] = [
  [
    "full_build_review",
    "Full Build Review",
    "Review the whole build, register issues, plan fixes, verify, judge, and report.",
    ["Review build", "Prioritize issues", "Plan fixes", "Verify results"],
    "high",
    "mandatory",
    "medium",
  ],
  [
    "continuous_improvement",
    "Continuous Improvement",
    "Find the next useful improvement, apply safely, verify, and reassess value.",
    ["Find improvement", "Plan change", "Verify value"],
    "standard",
    "optional",
    "low",
  ],
  [
    "bug_hunt",
    "Bug Hunt",
    "Search for broken flows, failing controls, regressions, and persistence bugs.",
    ["Find bugs", "Reproduce", "Fix plan", "Regression checks"],
    "high",
    "mandatory",
    "medium",
  ],
  [
    "production_readiness",
    "Production Readiness",
    "Check proof, safety, performance, rollback, and release readiness.",
    ["Readiness audit", "Risk closure", "Proof review"],
    "high",
    "mandatory",
    "medium",
  ],
  [
    "ui_ux_polish",
    "UI/UX Polish",
    "Improve clarity, hierarchy, accessibility, and Apple-simple interaction flow.",
    ["Skim test", "Interaction polish", "Accessibility review"],
    "standard",
    "optional",
    "low",
  ],
  [
    "refactor",
    "Refactor",
    "Simplify implementation without changing user-visible behavior.",
    ["Find complexity", "Refactor plan", "Safety checks"],
    "standard",
    "optional",
    "medium",
  ],
  [
    "test_verify",
    "Test/Verify",
    "Strengthen tests, smoke proof, manual verification, and result reporting.",
    ["Find test gaps", "Add proof plan", "Run verification"],
    "standard",
    "optional",
    "low",
  ],
  [
    "milestone_cleanup",
    "Milestone Cleanup",
    "Clean stale blockers, unclear milestones, missing receipts, and sequence issues.",
    ["Audit milestones", "Repair sequence", "Receipt gaps"],
    "standard",
    "optional",
    "low",
  ],
  [
    "launch_prep",
    "Launch Prep",
    "Prepare final checks, risk review, judge signoff, and launch report.",
    ["Launch checklist", "Risk signoff", "Final judge"],
    "high",
    "mandatory",
    "medium",
  ],
].map(([id, title, description, defaultPromptTitles, reasoning, judge, approvalTier]) => ({
  id: id as PccAutopilotModeId,
  title: title as string,
  description: description as string,
  defaultPromptTitles: defaultPromptTitles as string[],
  suggestedExecutor: "safe_stub",
  suggestedReasoningLevel: reasoning as PccAutopilotReasoningLevel,
  suggestedJudge: judge as PccAutopilotJudgeSetting,
  approvalTier: approvalTier as PccAutopilotApprovalTier,
  defaultStopCondition: { kind: "after_n_sets", limit: 1, enabled: true },
}));

const DEFAULT_FORBIDDEN_ACTIONS = [
  "Do not spend Codex or high-reasoning tokens without separate explicit permission.",
  "Do not deploy, reboot, delete files, change credentials, or perform external writes.",
  "Stop for high-risk actions and record a blocker instead of proceeding.",
];

function metadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function modePreset(mode: PccAutopilotModeId): PccAutopilotModePreset {
  return PCC_AUTOPILOT_MODES.find((preset) => preset.id === mode) ?? PCC_AUTOPILOT_MODES[0];
}

function modeFromUnknown(value: unknown): PccAutopilotModeId {
  return PCC_AUTOPILOT_MODES.some((preset) => preset.id === value)
    ? (value as PccAutopilotModeId)
    : "full_build_review";
}

function statusFromUnknown(value: unknown): PccAutopilotStatus {
  const allowed = new Set<PccAutopilotStatus>([
    "off",
    "ready",
    "running",
    "paused",
    "blocked",
    "needs_approval",
    "failed",
    "completed",
  ]);
  return typeof value === "string" && allowed.has(value as PccAutopilotStatus)
    ? (value as PccAutopilotStatus)
    : "off";
}

function executorFromUnknown(value: unknown): PccAutopilotExecutorKind {
  return value === "codex" || value === "local_model" || value === "safe_stub"
    ? value
    : "safe_stub";
}

function approvalTierFromUnknown(value: unknown): PccAutopilotApprovalTier {
  return value === "medium" || value === "high" ? value : "low";
}

const PCC_AUTOPILOT_RISK_RANK: Record<PccAutopilotApprovalTier, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

function approvalTierLabel(tier: PccAutopilotApprovalTier): string {
  return `${tier}-risk`;
}

function approvalTierAtLeast(
  current: PccAutopilotApprovalTier,
  minimum: PccAutopilotApprovalTier,
): boolean {
  return PCC_AUTOPILOT_RISK_RANK[current] >= PCC_AUTOPILOT_RISK_RANK[minimum];
}

function highestApprovalTier(
  tiers: readonly PccAutopilotApprovalTier[],
): PccAutopilotApprovalTier | null {
  return tiers.reduce<PccAutopilotApprovalTier | null>((highest, tier) => {
    if (!highest || PCC_AUTOPILOT_RISK_RANK[tier] > PCC_AUTOPILOT_RISK_RANK[highest]) {
      return tier;
    }
    return highest;
  }, null);
}

function approvalPolicyAllowsTier(
  policy: PccAutopilotApprovalPolicy,
  tier: PccAutopilotApprovalTier,
): boolean {
  if (!approvalTierAtLeast(policy.maxRiskTier, tier)) {
    return false;
  }
  if (tier === "high") {
    return policy.allowHighRisk;
  }
  if (tier === "medium") {
    return policy.allowMediumRisk;
  }
  return policy.allowLowRisk;
}

function policySummary(policy: PccAutopilotApprovalPolicy): string {
  return [
    `Low: ${policy.allowLowRisk ? "allowed" : "approval required"}`,
    `Medium: ${policy.allowMediumRisk ? "allowed" : "approval required"}`,
    `High: ${policy.allowHighRisk ? "allowed" : "separate approval required"}`,
    `Maximum approved tier: ${approvalTierLabel(policy.maxRiskTier)}`,
  ].join(" · ");
}

export function buildPccAutopilotPermissionForecast(
  state: PccAutopilotState,
): PccAutopilotPermissionForecast {
  const blockedSlots = state.promptSlots
    .filter((slot) => slot.enabled)
    .filter((slot) => !approvalPolicyAllowsTier(state.approvalPolicy, slot.approvalTier));
  const requiredTier = highestApprovalTier(blockedSlots.map((slot) => slot.approvalTier));
  if (!requiredTier) {
    return {
      required: false,
      requiredTier: null,
      promptSlotIds: [],
      promptTitles: [],
      reason: "All enabled prompt slots are inside the current approval policy.",
      recommendedNextAction: "Start the safe loop or edit prompts before running.",
      policySummary: policySummary(state.approvalPolicy),
    };
  }
  const promptTitles = blockedSlots.map((slot) => slot.title);
  return {
    required: true,
    requiredTier,
    promptSlotIds: blockedSlots.map((slot) => slot.id),
    promptTitles,
    reason: `${promptTitles.length} enabled prompt${promptTitles.length === 1 ? "" : "s"} require ${approvalTierLabel(requiredTier)} approval before the loop starts.`,
    recommendedNextAction: `Review the prompt list, then approve ${approvalTierLabel(requiredTier)} Autopilot work for this project or lower the prompt risk tier.`,
    policySummary: policySummary(state.approvalPolicy),
  };
}

function approvalPolicyWithTier(
  policy: PccAutopilotApprovalPolicy,
  tier: PccAutopilotApprovalTier,
): PccAutopilotApprovalPolicy {
  return {
    ...policy,
    allowLowRisk: true,
    allowMediumRisk: policy.allowMediumRisk || approvalTierAtLeast(tier, "medium"),
    allowHighRisk: policy.allowHighRisk || tier === "high",
    maxRiskTier: highestApprovalTier([policy.maxRiskTier, tier]) ?? tier,
    note: `${approvalTierLabel(tier)} Autopilot permission approved for this project. Higher-risk, external, destructive, credential, deployment, reboot, and Codex/high-reasoning actions still require separate approval when outside this scope.`,
  };
}

export function applyPccAutopilotPermissionAction(
  state: PccAutopilotState,
  action: Extract<
    PccAutopilotAction,
    "allow_low_risk" | "allow_medium_risk" | "allow_high_risk" | "deny_permission"
  >,
  now: string,
): PccAutopilotState {
  if (action === "deny_permission") {
    return {
      ...state,
      status: "blocked",
      currentBlocker: {
        type: "needs_user_decision",
        whyBlocked: "Autopilot permission request was denied or deferred.",
        attempted: "Advance permission preflight before starting the loop.",
        needed: "User approval or edited lower-risk prompt slots before continuing.",
        recommendedNextAction:
          "Edit prompts, lower the risk tier, or approve the requested scope later.",
        owner: "User",
      },
      auditLog: [
        ...state.auditLog,
        audit(now, "permission_denied", "Autopilot permission request was denied or deferred."),
      ].slice(-200),
      updatedAt: now,
    };
  }
  const tier =
    action === "allow_high_risk" ? "high" : action === "allow_medium_risk" ? "medium" : "low";
  const nextPolicy = approvalPolicyWithTier(state.approvalPolicy, tier);
  return {
    ...state,
    status: "ready",
    approvalPolicy: nextPolicy,
    currentBlocker:
      state.currentBlocker?.type === "needs_approval" ? undefined : state.currentBlocker,
    auditLog: [
      ...state.auditLog,
      audit(
        now,
        "permission_approved",
        `${approvalTierLabel(tier)} Autopilot permission approved for this project.`,
      ),
    ].slice(-200),
    updatedAt: now,
  };
}

function judgeFromUnknown(value: unknown): PccAutopilotJudgeSetting {
  return value === "off" || value === "mandatory" ? value : "optional";
}

function safeId(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function audit(
  at: string,
  event: string,
  summary: string,
): { at: string; event: string; summary: string } {
  return { at, event, summary };
}

function defaultPromptBody(preset: PccAutopilotModePreset, title: string): string {
  return [
    `Mode: ${preset.title}`,
    `Task: ${title}`,
    "Review the structured PCC context pack.",
    "Identify the highest-value safe action for this prompt.",
    "Do not perform high-risk actions, external writes, deployment, credential changes, deletion, or Codex/high-reasoning token spend without separate approval.",
    "Return a concise issue list, recommended fix path, verification needed, blockers, and judge-ready summary.",
  ].join("\n");
}

function normalizePromptSlot(
  value: unknown,
  index: number,
  preset: PccAutopilotModePreset,
): PccAutopilotPromptSlot | null {
  const raw = metadataObject(value);
  const title =
    stringValue(raw.title) || preset.defaultPromptTitles[index] || `Prompt ${index + 1}`;
  return {
    id: stringValue(raw.id) || `slot-${index + 1}-${safeId(title) || "prompt"}`,
    enabled: boolValue(raw.enabled, index === 0),
    title,
    promptBody: stringValue(raw.promptBody) || defaultPromptBody(preset, title),
    purpose: stringValue(raw.purpose) || preset.description,
    executor:
      executorFromUnknown(raw.executor) === "codex"
        ? "safe_stub"
        : executorFromUnknown(raw.executor),
    reasoningLevel: raw.reasoningLevel === "high" ? "high" : "standard",
    localModelId: stringValue(raw.localModelId) || undefined,
    backupModelId: stringValue(raw.backupModelId) || undefined,
    approvalTier: approvalTierFromUnknown(raw.approvalTier),
    judge: judgeFromUnknown(raw.judge),
    version: Math.max(1, Math.trunc(numberValue(raw.version, 1))),
    lastRunResult: stringValue(raw.lastRunResult) || undefined,
    lastRunAt: stringValue(raw.lastRunAt) || undefined,
  };
}

function activeMilestones(input: PccAutopilotProjectInput): PccMilestone[] {
  return input.milestones.filter(
    (item) =>
      !["complete", "complete_with_maintenance", "skipped", "archived"].includes(item.status),
  );
}

function projectBlockers(input: PccAutopilotProjectInput): string[] {
  const blockers = [
    ...input.milestones.flatMap((item) => (item.blocker ? [`${item.title}: ${item.blocker}`] : [])),
    ...input.subMilestones.flatMap((item) =>
      item.blocker ? [`${item.title}: ${item.blocker}`] : [],
    ),
    ...(input.permissions ?? []).flatMap((permission) =>
      permission.status === "needed" || permission.status === "blocked"
        ? [`Permission ${permission.status}: ${permission.type}`]
        : [],
    ),
  ];
  return [...new Set(blockers)];
}

export function generatePccAutopilotPromptSlots(
  input: PccAutopilotProjectInput,
  mode: PccAutopilotModeId,
): PccAutopilotPromptSlot[] {
  const preset = modePreset(mode);
  const blockers = projectBlockers(input).slice(0, 3);
  const currentMilestone = activeMilestones(input)[0];
  return preset.defaultPromptTitles.slice(0, 5).map((title, index) => ({
    id: `slot-${index + 1}-${safeId(title)}`,
    enabled: index < Math.min(3, preset.defaultPromptTitles.length),
    title,
    promptBody: [
      `Project: ${input.project.title}`,
      `Goal: ${input.project.goal || "No goal recorded."}`,
      `Mode: ${preset.title}`,
      currentMilestone ? `Current milestone: ${currentMilestone.title}` : "Current milestone: none",
      blockers.length ? `Known blockers: ${blockers.join("; ")}` : "Known blockers: none recorded",
      defaultPromptBody(preset, title),
    ].join("\n"),
    purpose: preset.description,
    executor: preset.suggestedExecutor,
    reasoningLevel: preset.suggestedReasoningLevel,
    approvalTier: preset.approvalTier,
    judge: preset.suggestedJudge,
    version: 1,
  }));
}

export function defaultPccAutopilotState(
  input: PccAutopilotProjectInput,
  now: string,
): PccAutopilotState {
  const preset = modePreset("full_build_review");
  return {
    version: 1,
    status: "off",
    mode: preset.id,
    modeTitle: preset.title,
    promptSlots: generatePccAutopilotPromptSlots(input, preset.id),
    approvalPolicy: {
      allowLowRisk: true,
      allowMediumRisk: false,
      allowHighRisk: false,
      maxRiskTier: "low",
      note: "Low-risk analysis and local verification may run. Medium/high risk work requires separate approval.",
    },
    stopConditions: [
      preset.defaultStopCondition,
      { kind: "blocked", enabled: true },
      { kind: "max_failures", limit: 2, enabled: true },
      { kind: "judge_failure", limit: 1, enabled: true },
      { kind: "max_risk_tier", enabled: true },
    ],
    currentSet: 0,
    completedSets: 0,
    totalPromptIterations: 0,
    currentExecutor: preset.suggestedExecutor,
    latestJudgeResult: {
      status: "not_run",
      summary: "Judge has not reviewed this loop yet.",
      evidence: [],
    },
    runHistory: [],
    auditLog: [audit(now, "created", "Autopilot Project Loop initialized in safe mode.")],
    updatedAt: now,
  };
}

function stopConditionKind(value: unknown): PccAutopilotStopCondition["kind"] {
  const allowed: PccAutopilotStopCondition["kind"][] = [
    "after_n_sets",
    "after_n_prompt_runs",
    "after_current_prompt",
    "after_current_set",
    "blocked",
    "max_failures",
    "judge_failure",
    "no_meaningful_improvement",
    "max_risk_tier",
    "max_changed_files",
  ];
  return allowed.includes(value as PccAutopilotStopCondition["kind"])
    ? (value as PccAutopilotStopCondition["kind"])
    : "after_n_sets";
}

function blockerType(value: unknown): PccAutopilotBlockerType {
  const allowed: PccAutopilotBlockerType[] = [
    "needs_user_decision",
    "needs_approval",
    "tool_unavailable",
    "api_unavailable",
    "missing_credential",
    "test_failure",
    "build_failure",
    "ambiguous_requirement",
    "conflicting_instruction",
    "unsafe_action",
    "repeated_failure",
    "external_dependency",
    "no_meaningful_improvement_found",
  ];
  return allowed.includes(value as PccAutopilotBlockerType)
    ? (value as PccAutopilotBlockerType)
    : "needs_user_decision";
}

function normalizeBlocker(value: unknown): PccAutopilotBlocker | undefined {
  const raw = metadataObject(value);
  const whyBlocked = stringValue(raw.whyBlocked);
  if (!whyBlocked) {
    return undefined;
  }
  return {
    type: blockerType(raw.type),
    whyBlocked,
    attempted: stringValue(raw.attempted) || "Autopilot attempted the current prompt.",
    needed: stringValue(raw.needed) || "User decision or permission is needed.",
    recommendedNextAction:
      stringValue(raw.recommendedNextAction) || "Review blocker and choose a safe next action.",
    owner: stringValue(raw.owner) || "User",
  };
}

function normalizeJudgeResult(value: unknown): PccAutopilotJudgeResult | undefined {
  const raw = metadataObject(value);
  const summary = stringValue(raw.summary);
  if (!summary) {
    return undefined;
  }
  const status = raw.status === "passed" || raw.status === "failed" ? raw.status : "not_run";
  return {
    status,
    summary,
    evidence: stringArray(raw.evidence),
    repairRecommendation: stringValue(raw.repairRecommendation) || undefined,
    reviewedAt: stringValue(raw.reviewedAt) || undefined,
  };
}

function normalizeRunRecord(value: unknown): PccAutopilotRunRecord | null {
  const raw = metadataObject(value);
  const id = stringValue(raw.id);
  const promptSlotId = stringValue(raw.promptSlotId);
  if (!id || !promptSlotId) {
    return null;
  }
  return {
    id,
    timestamp: stringValue(raw.timestamp) || new Date().toISOString(),
    projectId: stringValue(raw.projectId),
    loopMode: modeFromUnknown(raw.loopMode),
    promptSlotId,
    promptTitle: stringValue(raw.promptTitle) || "Prompt",
    promptVersion: Math.max(1, Math.trunc(numberValue(raw.promptVersion, 1))),
    executor: executorFromUnknown(raw.executor),
    model: stringValue(raw.model) || undefined,
    reasoningLevel: raw.reasoningLevel === "high" ? "high" : "standard",
    inputContextSummary: stringValue(raw.inputContextSummary) || "Context pack supplied.",
    outputSummary: stringValue(raw.outputSummary) || "No output summary recorded.",
    changedFiles: stringArray(raw.changedFiles),
    artifacts: stringArray(raw.artifacts),
    approvals: stringArray(raw.approvals),
    checksRun: stringArray(raw.checksRun),
    judgeResult: normalizeJudgeResult(raw.judgeResult),
    blocker: normalizeBlocker(raw.blocker),
    rawOutput: stringValue(raw.rawOutput) || "",
    useful: typeof raw.useful === "boolean" ? raw.useful : undefined,
  };
}

function normalizeFinalReport(value: unknown): PccAutopilotFinalReport | undefined {
  const raw = metadataObject(value);
  const projectName = stringValue(raw.projectName);
  if (!projectName) {
    return undefined;
  }
  return {
    projectName,
    selectedLoopMode: modeFromUnknown(raw.selectedLoopMode),
    promptsUsed: stringArray(raw.promptsUsed),
    promptVersions: stringArray(raw.promptVersions),
    setsCompleted: Math.max(0, Math.trunc(numberValue(raw.setsCompleted, 0))),
    totalPromptRuns: Math.max(0, Math.trunc(numberValue(raw.totalPromptRuns, 0))),
    issuesFound: stringArray(raw.issuesFound),
    issuesFixed: stringArray(raw.issuesFixed),
    issuesUnresolved: stringArray(raw.issuesUnresolved),
    blockersEncountered: stringArray(raw.blockersEncountered),
    approvalsUsed: stringArray(raw.approvalsUsed),
    filesChanged: stringArray(raw.filesChanged),
    artifactsCreated: stringArray(raw.artifactsCreated),
    checksRun: stringArray(raw.checksRun),
    judgeResult: stringValue(raw.judgeResult) || "Judge not run.",
    remainingRisks: stringArray(raw.remainingRisks),
    recommendedNextLoop: modeFromUnknown(raw.recommendedNextLoop),
    healthierThanBefore: boolValue(raw.healthierThanBefore, false),
    generatedAt: stringValue(raw.generatedAt) || new Date().toISOString(),
  };
}

export function getPccAutopilotState(
  input: PccAutopilotProjectInput,
  now = new Date().toISOString(),
): PccAutopilotState {
  const raw = metadataObject(input.project.metadata).pccAutopilot;
  const autopilot = metadataObject(raw);
  if (Object.keys(autopilot).length === 0) {
    return defaultPccAutopilotState(input, now);
  }
  const mode = modeFromUnknown(autopilot.mode);
  const preset = modePreset(mode);
  const promptSlots = Array.isArray(autopilot.promptSlots)
    ? autopilot.promptSlots
        .slice(0, 5)
        .map((slot, index) => normalizePromptSlot(slot, index, preset))
        .filter((slot): slot is PccAutopilotPromptSlot => Boolean(slot))
    : generatePccAutopilotPromptSlots(input, mode);
  return {
    version: 1,
    status: statusFromUnknown(autopilot.status),
    mode,
    modeTitle: stringValue(autopilot.modeTitle) || preset.title,
    promptSlots,
    approvalPolicy: {
      allowLowRisk: boolValue(metadataObject(autopilot.approvalPolicy).allowLowRisk, true),
      allowMediumRisk: boolValue(metadataObject(autopilot.approvalPolicy).allowMediumRisk, false),
      allowHighRisk: boolValue(metadataObject(autopilot.approvalPolicy).allowHighRisk, false),
      maxRiskTier: approvalTierFromUnknown(metadataObject(autopilot.approvalPolicy).maxRiskTier),
      note:
        stringValue(metadataObject(autopilot.approvalPolicy).note) ||
        "Low-risk analysis and local verification may run. Medium/high risk work requires separate approval.",
    },
    stopConditions: Array.isArray(autopilot.stopConditions)
      ? autopilot.stopConditions.slice(0, 10).map((condition) => {
          const rawCondition = metadataObject(condition);
          return {
            kind: stopConditionKind(rawCondition.kind),
            limit: numberValue(rawCondition.limit, 0) || undefined,
            enabled: boolValue(rawCondition.enabled, true),
          };
        })
      : [preset.defaultStopCondition],
    currentSet: Math.max(0, Math.trunc(numberValue(autopilot.currentSet, 0))),
    completedSets: Math.max(0, Math.trunc(numberValue(autopilot.completedSets, 0))),
    totalPromptIterations: Math.max(0, Math.trunc(numberValue(autopilot.totalPromptIterations, 0))),
    activePromptSlotId: stringValue(autopilot.activePromptSlotId) || undefined,
    currentExecutor: executorFromUnknown(autopilot.currentExecutor),
    currentModel: stringValue(autopilot.currentModel) || undefined,
    lastOutputSummary: stringValue(autopilot.lastOutputSummary) || undefined,
    currentBlocker: normalizeBlocker(autopilot.currentBlocker),
    latestJudgeResult: normalizeJudgeResult(autopilot.latestJudgeResult),
    runHistory: Array.isArray(autopilot.runHistory)
      ? autopilot.runHistory
          .slice(-100)
          .map(normalizeRunRecord)
          .filter((record): record is PccAutopilotRunRecord => Boolean(record))
      : [],
    auditLog: Array.isArray(autopilot.auditLog)
      ? autopilot.auditLog.slice(-200).map((entry) => {
          const rawEntry = metadataObject(entry);
          return {
            at: stringValue(rawEntry.at) || now,
            event: stringValue(rawEntry.event) || "event",
            summary: stringValue(rawEntry.summary) || "Autopilot event recorded.",
          };
        })
      : [],
    finalReport: normalizeFinalReport(autopilot.finalReport),
    updatedAt: stringValue(autopilot.updatedAt) || now,
  };
}

export function buildPccAutopilotContextPack(
  input: PccAutopilotProjectInput,
  state: PccAutopilotState,
): PccAutopilotContextPack {
  const active = activeMilestones(input);
  const blockers = projectBlockers(input);
  return {
    projectSummary: `${input.project.title}: ${input.project.goal || "No goal recorded."}`,
    selectedLoopMode: state.mode,
    currentObjective: modePreset(state.mode).description,
    activeMilestones: active.slice(0, 20).map((item) => `${item.title} (${item.status})`),
    blockers: blockers.length ? blockers : ["No explicit blockers recorded."],
    recentChanges: [
      `Project updated: ${input.project.updatedAt}`,
      ...input.milestones
        .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 5)
        .map((item) => `${item.title}: ${item.status}`),
    ],
    priorPromptOutput: state.runHistory.at(-1)?.outputSummary ?? "No prior prompt output.",
    currentRisks: [
      ...blockers.slice(0, 5),
      state.approvalPolicy.allowHighRisk
        ? "High-risk approval enabled."
        : "High-risk actions are blocked.",
    ],
    definitionOfDone: [
      "Prompt output is recorded in history.",
      "Required approvals are logged before risky work.",
      "Judge result is visible for major modes.",
      "Final report lists issues, checks, risks, and next loop.",
    ],
    relevantArtifacts: [
      ...(input.evidence ?? []).slice(0, 10).map((item) => item.summary || item.kind),
      ...(input.decisions ?? []).slice(0, 5).map((item) => item.title),
    ],
    approvalRules: [
      state.approvalPolicy.note,
      `Low risk: ${state.approvalPolicy.allowLowRisk ? "allowed" : "approval required"}`,
      `Medium risk: ${state.approvalPolicy.allowMediumRisk ? "allowed" : "approval required"}`,
      `High risk: ${state.approvalPolicy.allowHighRisk ? "allowed" : "separate approval required"}`,
    ],
    forbiddenActions: DEFAULT_FORBIDDEN_ACTIONS,
    userPreferences: [
      "Keep PCC skim-first, reliable, and proof-backed.",
      "Do not claim completion without verified evidence.",
      "Stop and report exact blockers instead of guessing around them.",
    ],
    judgeFindings: state.latestJudgeResult
      ? [state.latestJudgeResult.summary, ...state.latestJudgeResult.evidence]
      : ["No judge findings yet."],
    stopConditions: state.stopConditions
      .filter((condition) => condition.enabled)
      .map((condition) => `${condition.kind}${condition.limit ? `=${condition.limit}` : ""}`),
  };
}

function runId(now: string, slotId: string): string {
  return `autopilot-run-${now.replace(/[^0-9A-Za-z]/g, "")}-${safeId(slotId)}`;
}

function contextSummary(context: PccAutopilotContextPack): string {
  return [
    context.projectSummary,
    `Mode: ${context.selectedLoopMode}`,
    `Active milestones: ${context.activeMilestones.length}`,
    `Blockers: ${context.blockers.slice(0, 3).join("; ")}`,
  ].join(" | ");
}

export function buildPccAutopilotJudgeResult(
  state: PccAutopilotState,
  runs: readonly PccAutopilotRunRecord[],
  now: string,
): PccAutopilotJudgeResult {
  const requiresJudge =
    modePreset(state.mode).suggestedJudge === "mandatory" ||
    runs.some(
      (run) => run.judgeResult?.status === "failed" || run.judgeResult?.status === "passed",
    );
  if (!requiresJudge) {
    return {
      status: "not_run",
      summary: "Judge review is optional for this loop mode.",
      evidence: [],
    };
  }
  const failed = runs.find((run) => run.blocker || run.judgeResult?.status === "failed");
  if (failed) {
    return {
      status: "failed",
      summary:
        failed.blocker?.whyBlocked ??
        failed.judgeResult?.summary ??
        "Judge found an unresolved blocker.",
      evidence: ["Run history recorded", "Blocker preserved", "No false completion marked"],
      repairRecommendation:
        failed.blocker?.recommendedNextAction ?? failed.judgeResult?.repairRecommendation,
      reviewedAt: now,
    };
  }
  return {
    status: "passed",
    summary:
      "Judge verified that the safe Autopilot loop recorded context, run history, limitations, and final report.",
    evidence: ["Context pack present", "Prompt run history present", "Final report generated"],
    reviewedAt: now,
  };
}

export function buildPccAutopilotFinalReport(
  input: PccAutopilotProjectInput,
  state: PccAutopilotState,
  now: string,
): PccAutopilotFinalReport {
  const runs = state.runHistory;
  const blockers = [
    ...runs.flatMap((run) => (run.blocker ? [run.blocker.whyBlocked] : [])),
    ...(state.currentBlocker ? [state.currentBlocker.whyBlocked] : []),
  ];
  const issuesFound = [...projectBlockers(input), ...blockers];
  return {
    projectName: input.project.title,
    selectedLoopMode: state.mode,
    promptsUsed: state.promptSlots.filter((slot) => slot.enabled).map((slot) => slot.title),
    promptVersions: state.promptSlots.map((slot) => `${slot.title}: v${slot.version}`),
    setsCompleted: state.completedSets,
    totalPromptRuns: state.totalPromptIterations,
    issuesFound: issuesFound.length
      ? [...new Set(issuesFound)]
      : ["No explicit issues found by safe stub loop."],
    issuesFixed: [],
    issuesUnresolved: blockers.length
      ? [...new Set(blockers)]
      : ["Live implementation was not run in safe stub mode."],
    blockersEncountered: [...new Set(blockers)],
    approvalsUsed: [...new Set(runs.flatMap((run) => run.approvals))],
    filesChanged: [...new Set(runs.flatMap((run) => run.changedFiles))],
    artifactsCreated: [...new Set(runs.flatMap((run) => run.artifacts))],
    checksRun: [...new Set(runs.flatMap((run) => run.checksRun))],
    judgeResult: state.latestJudgeResult?.summary ?? "Judge not run.",
    remainingRisks: [
      "Safe stub mode does not make live code changes.",
      ...blockers,
      ...DEFAULT_FORBIDDEN_ACTIONS,
    ],
    recommendedNextLoop: state.mode === "full_build_review" ? "bug_hunt" : "test_verify",
    healthierThanBefore: state.status === "completed" && runs.length > 0,
    generatedAt: now,
  };
}

export function runPccAutopilotSafeStubSet(
  input: PccAutopilotProjectInput,
  state: PccAutopilotState,
  now: string,
): PccAutopilotState {
  const enabled = state.promptSlots.filter((slot) => slot.enabled).slice(0, 5);
  if (enabled.length === 0) {
    return {
      ...state,
      status: "blocked",
      currentBlocker: {
        type: "ambiguous_requirement",
        whyBlocked: "At least one enabled prompt slot is required before Autopilot can start.",
        attempted: "Start Autopilot Project Loop.",
        needed: "Enable or generate one prompt slot.",
        recommendedNextAction: "Click Generate Loop Prompts, review the prompts, then start again.",
        owner: "User",
      },
      auditLog: [
        ...state.auditLog,
        audit(now, "blocked", "Autopilot start blocked: no enabled prompt slots."),
      ],
      updatedAt: now,
    };
  }
  const forecast = buildPccAutopilotPermissionForecast(state);
  if (forecast.required && forecast.requiredTier) {
    const blocker: PccAutopilotBlocker = {
      type: "needs_approval",
      whyBlocked: forecast.reason,
      attempted: "Advance permission preflight before starting the loop.",
      needed: `Approve ${approvalTierLabel(forecast.requiredTier)} Autopilot work for this project or lower the prompt risk tier.`,
      recommendedNextAction: forecast.recommendedNextAction,
      owner: "User",
    };
    const judgeResult: PccAutopilotJudgeResult = {
      status: "failed",
      summary: "Judge cannot pass completion while Autopilot is waiting for permission.",
      evidence: [
        "Permission preflight ran",
        "No prompt execution occurred",
        "No unsafe action was taken",
      ],
      repairRecommendation: forecast.recommendedNextAction,
      reviewedAt: now,
    };
    const nextState: PccAutopilotState = {
      ...state,
      status: "needs_approval",
      currentBlocker: blocker,
      latestJudgeResult: judgeResult,
      lastOutputSummary: forecast.reason,
      auditLog: [...state.auditLog, audit(now, "permission_required", forecast.reason)].slice(-200),
      updatedAt: now,
    };
    return { ...nextState, finalReport: buildPccAutopilotFinalReport(input, nextState, now) };
  }

  const context = buildPccAutopilotContextPack(input, state);
  const runs = enabled.map((slot, index): PccAutopilotRunRecord => {
    return {
      id: runId(`${now}-${index}`, slot.id),
      timestamp: now,
      projectId: input.project.id,
      loopMode: state.mode,
      promptSlotId: slot.id,
      promptTitle: slot.title,
      promptVersion: slot.version,
      executor: "safe_stub",
      model: slot.localModelId || "safe-stub",
      reasoningLevel: slot.reasoningLevel,
      inputContextSummary: contextSummary(context),
      outputSummary: `Safe stub completed ${slot.title}. It produced review guidance only and changed no files.`,
      changedFiles: [],
      artifacts: [],
      approvals: [`${approvalTierLabel(slot.approvalTier)} approval policy satisfied`],
      checksRun: ["Autopilot context pack generated", "Safe stub execution recorded"],
      judgeResult:
        slot.judge === "mandatory"
          ? {
              status: "passed",
              summary:
                "Judge accepted the safe stub run as a recorded planning/review pass, not as live implementation.",
              evidence: [
                "Context pack present",
                "Run history recorded",
                "No high-risk action performed",
              ],
              reviewedAt: now,
            }
          : undefined,
      rawOutput: [
        `Prompt: ${slot.title}`,
        slot.promptBody,
        "",
        "Safe stub result: no Codex/high-reasoning token spend, no file edits, no deployment, no external writes.",
        "Result: review guidance recorded successfully.",
      ].join("\n"),
    };
  });
  const blocker = runs.find((run) => run.blocker)?.blocker;
  const judgeResult = buildPccAutopilotJudgeResult(state, runs, now);
  const nextSlots = state.promptSlots.map((slot) => {
    const run = runs.find((item) => item.promptSlotId === slot.id);
    return run ? { ...slot, lastRunResult: run.outputSummary, lastRunAt: now } : slot;
  });
  const status: PccAutopilotStatus = blocker ? "needs_approval" : "completed";
  const nextState: PccAutopilotState = {
    ...state,
    status,
    promptSlots: nextSlots,
    currentSet: state.currentSet + 1,
    completedSets: blocker ? state.completedSets : state.completedSets + 1,
    totalPromptIterations: state.totalPromptIterations + runs.length,
    activePromptSlotId: runs.at(-1)?.promptSlotId,
    currentExecutor: "safe_stub",
    currentModel: "safe-stub",
    lastOutputSummary: runs.at(-1)?.outputSummary,
    currentBlocker: blocker,
    latestJudgeResult: judgeResult,
    runHistory: [...state.runHistory, ...runs].slice(-100),
    auditLog: [
      ...state.auditLog,
      audit(
        now,
        "started",
        `Started ${state.modeTitle} with ${enabled.length} enabled prompt slots.`,
      ),
      audit(
        now,
        status,
        blocker ? blocker.whyBlocked : "Autopilot set completed in safe stub mode.",
      ),
    ].slice(-200),
    updatedAt: now,
  };
  return { ...nextState, finalReport: buildPccAutopilotFinalReport(input, nextState, now) };
}

export function withPccAutopilotState(
  project: PccProject,
  autopilot: PccAutopilotState,
): PccProject {
  return { ...project, metadata: { ...metadataObject(project.metadata), pccAutopilot: autopilot } };
}

export function configurePccAutopilotMode(
  input: PccAutopilotProjectInput,
  state: PccAutopilotState,
  mode: PccAutopilotModeId,
  now: string,
): PccAutopilotState {
  const preset = modePreset(mode);
  return {
    ...state,
    status: "ready",
    mode,
    modeTitle: preset.title,
    promptSlots: generatePccAutopilotPromptSlots(input, mode),
    currentExecutor: preset.suggestedExecutor,
    stopConditions: [
      preset.defaultStopCondition,
      ...state.stopConditions.filter((condition) => condition.kind !== "after_n_sets"),
    ].slice(0, 10),
    auditLog: [...state.auditLog, audit(now, "configured", `Configured ${preset.title}.`)].slice(
      -200,
    ),
    updatedAt: now,
  };
}

export function updatePccAutopilotPromptSlot(
  state: PccAutopilotState,
  slotId: string,
  patch: Partial<PccAutopilotPromptSlot>,
  now: string,
): PccAutopilotState {
  const promptSlots = state.promptSlots.map((slot) =>
    slot.id === slotId
      ? {
          ...slot,
          ...patch,
          executor: patch.executor === "codex" ? "safe_stub" : (patch.executor ?? slot.executor),
          version:
            patch.promptBody !== undefined && patch.promptBody !== slot.promptBody
              ? slot.version + 1
              : (patch.version ?? slot.version),
        }
      : slot,
  );
  return {
    ...state,
    status: state.status === "off" ? "ready" : state.status,
    promptSlots,
    auditLog: [
      ...state.auditLog,
      audit(now, "prompt_updated", `Updated prompt slot ${slotId}.`),
    ].slice(-200),
    updatedAt: now,
  };
}

export function transitionPccAutopilotState(
  state: PccAutopilotState,
  action: "pause" | "resume" | "stop" | "block",
  now: string,
): PccAutopilotState {
  if (action === "pause") {
    return {
      ...state,
      status: "paused",
      auditLog: [...state.auditLog, audit(now, "paused", "Autopilot paused safely.")],
      updatedAt: now,
    };
  }
  if (action === "resume") {
    return {
      ...state,
      status: "ready",
      auditLog: [
        ...state.auditLog,
        audit(now, "resumed", "Autopilot resumed and is ready to run."),
      ],
      updatedAt: now,
    };
  }
  if (action === "stop") {
    return {
      ...state,
      status: "off",
      auditLog: [...state.auditLog, audit(now, "stopped", "Autopilot stopped after saving state.")],
      updatedAt: now,
    };
  }
  return {
    ...state,
    status: "blocked",
    currentBlocker: {
      type: "needs_user_decision",
      whyBlocked: "User marked the Autopilot loop blocked.",
      attempted: "Manual block command.",
      needed: "User decision before continuing.",
      recommendedNextAction: "Review history, update prompts or approvals, then resume.",
      owner: "User",
    },
    auditLog: [...state.auditLog, audit(now, "blocked", "User marked Autopilot blocked.")],
    updatedAt: now,
  };
}

export function autopilotStatusLabel(status: PccAutopilotStatus): string {
  return status.replace(/_/gu, " ").replace(/^./u, (letter) => letter.toUpperCase());
}

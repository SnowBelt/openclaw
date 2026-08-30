/** Shared, model-neutral curator contract values. */

export const CURATOR_STATUS_VALUES = [
  "pending_review",
  "accepted_for_workshop",
  "rejected",
  "needs_more_evidence",
  "superseded",
  "promoted",
] as const;

export type CuratorStatus = (typeof CURATOR_STATUS_VALUES)[number];

export const CURATOR_DECISION_STATUS_VALUES = [
  "accepted_for_workshop",
  "rejected",
  "needs_more_evidence",
  "superseded",
] as const;

export type CuratorDecisionStatus = (typeof CURATOR_DECISION_STATUS_VALUES)[number];

export const CURATOR_SOURCE_CLASS_VALUES = [
  "task",
  "task_group",
  "cron_job",
  "skill_workshop",
  "skill_workshop_queue",
  "project_health",
  "configuration",
  "agent",
  "instruction",
  "workflow",
  "knowledge",
  "architecture",
  "risk",
  "outcome",
] as const;

export type CuratorSourceClass = (typeof CURATOR_SOURCE_CLASS_VALUES)[number];

export const CURATOR_CONFIDENCE_VALUES = ["low", "medium", "high"] as const;
export type CuratorConfidence = (typeof CURATOR_CONFIDENCE_VALUES)[number];

export const CURATOR_FRESHNESS_VALUES = ["current", "stale_risk", "unknown"] as const;
export type CuratorFreshness = (typeof CURATOR_FRESHNESS_VALUES)[number];

export const CURATOR_PRIVACY_VALUES = [
  "shared_safe",
  "private_reference_only",
  "blocked_sensitive",
] as const;
export type CuratorPrivacy = (typeof CURATOR_PRIVACY_VALUES)[number];

export const CURATOR_DISPATCH_STATUS_VALUES = [
  "pending",
  "running",
  "succeeded",
  "failed",
] as const;
export type CuratorDispatchStatus = (typeof CURATOR_DISPATCH_STATUS_VALUES)[number];

export const CURATOR_WORKSHOP_STATUS_VALUES = [
  "pending",
  "quarantined",
  "applied",
  "rejected",
] as const;
export type CuratorWorkshopStatus = (typeof CURATOR_WORKSHOP_STATUS_VALUES)[number];

export const CURATOR_REQUIRED_TOOL_NAMES = [
  "read",
  "memory_search",
  "memory_get",
  "sessions_list",
  "sessions_history",
  "session_status",
  "update_plan",
  "curator_get",
  "curator_decide",
] as const;

export const CURATOR_FORBIDDEN_TOOL_NAMES = [
  "write",
  "edit",
  "apply_patch",
  "exec",
  "process",
  "code_execution",
  "sessions_send",
  "sessions_spawn",
  "message",
  "browser",
  "web_search",
  "web_fetch",
  "cron",
] as const;

export const CURATOR_MAX_EVIDENCE_REFERENCES = 8;
export const CURATOR_MAX_OUTPUT_TOKENS = 2_048;
export const CURATOR_PROMPT_BUDGET_CHARS = 3_000;
